import { chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOTS_DIR = path.join(__dirname, 'test-screenshots');
const BASE_URL = 'http://localhost:3000';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function runTests() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\n' + '='.repeat(60));
  console.log('PLURA (MINDYARD) TEST REPORT - Issues #42, #43, #44');
  console.log('='.repeat(60) + '\n');

  try {
    // STEP 1: Login Page Check
    console.log('=== STEP 1: LOGIN PAGE CHECK (#42) ===\n');
    
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '01-initial-page.png'),
      fullPage: true 
    });
    
    const isLoginPage = currentUrl.includes('/login');
    
    if (isLoginPage) {
      console.log('✓ Redirected to login page');
      
      const pageContent = await page.content();
      const hasForgotPassword = pageContent.includes('パスワードを忘れた') || 
                                pageContent.includes('パスワードを忘れた方') ||
                                pageContent.includes('再設定');
      
      console.log(`\n[#42] "パスワードを忘れた方" link: ${hasForgotPassword ? '✅ PASS' : '❌ FAIL'}`);
      
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, '02-login-page.png'),
        fullPage: true 
      });
      
      // Try to register a new account
      console.log('\nAttempting to register new account...');
      const registerLink = page.locator('a[href="/register"]').first();
      await registerLink.click();
      await page.waitForLoadState('networkidle');
      
      // Fill registration form
      const testEmail = `test-${Date.now()}@example.com`;
      await page.fill('input[type="email"]', testEmail);
      await page.fill('input[type="password"]', 'TestPassword123!');
      
      console.log(`Registering with email: ${testEmail}`);
      
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
      
      console.log('Registration attempt completed');
    }
    
    // STEP 2: Empty State Check
    console.log('\n' + '='.repeat(60));
    console.log('=== STEP 2: EMPTY STATE CHECK (#43) ===\n');
    
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const pageContent2 = await page.content();
    
    const hasEmptyStateMessage = pageContent2.includes('うまく言えなくても大丈夫');
    console.log(`[#43] Empty state message "うまく言えなくても大丈夫": ${hasEmptyStateMessage ? '✅ PASS' : '❌ FAIL'}`);
    
    const hasNewConvButton = pageContent2.includes('新しい会話を始める');
    console.log(`[#42] "新しい会話を始める" button NOT visible before conversation: ${!hasNewConvButton ? '✅ PASS' : '❌ FAIL'}`);
    
    const hasInputExamples = pageContent2.includes('例:') || pageContent2.includes('例：');
    console.log(`[#43] Input examples visible: ${hasInputExamples ? '✅ PASS' : '❌ FAIL'}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '03-empty-state.png'),
      fullPage: true 
    });
    
    // STEP 3: Chat UI Check
    console.log('\n' + '='.repeat(60));
    console.log('=== STEP 3: CHAT UI CHECK (#42) ===\n');
    
    const textarea = page.locator('textarea').first();
    const textareaExists = await textarea.count() > 0;
    
    if (textareaExists) {
      const testMessage = '今日の会議でなんか引っかかったことがあって、コスト削減の話が出たんだけど本当にそれが問題なのか疑問に思った';
      await textarea.fill(testMessage);
      console.log('✓ Message typed');
      
      // Try to send
      await textarea.press('Enter');
      console.log('✓ Pressed Enter to send message');
      
      // Wait for response
      await page.waitForTimeout(8000);
      
      const html = await page.content();
      
      // Check message styling
      const styles = await page.evaluate(() => {
        const results: any = { user: null, assistant: null, hasMarkdown: false };
        
        // Look for user messages
        const userMsg = document.querySelector('[class*="user"], [data-role="user"]');
        if (userMsg) {
          const style = window.getComputedStyle(userMsg);
          results.user = {
            backgroundColor: style.backgroundColor,
            border: style.border
          };
        }
        
        // Look for assistant messages
        const assistantMsg = document.querySelector('[class*="assistant"], [data-role="assistant"]');
        if (assistantMsg) {
          const style = window.getComputedStyle(assistantMsg);
          results.assistant = {
            backgroundColor: style.backgroundColor,
            border: style.border
          };
          
          // Check for markdown elements
          results.hasMarkdown = !!(
            assistantMsg.querySelector('strong, em, h1, h2, h3, ul, ol, code')
          );
        }
        
        return results;
      });
      
      if (styles.user) {
        const userBg = styles.user.backgroundColor;
        console.log(`User message background: ${userBg}`);
        const isLightGray = userBg.includes('243, 244, 246');
        console.log(`[#42] User message background is light gray (#F3F4F6): ${isLightGray ? '✅ PASS' : '❌ FAIL (actual: ${userBg})'}`);
      } else {
        console.log(`[#42] User message styling: ⚠️  INFO - No user message found`);
      }
      
      if (styles.assistant) {
        const aiBg = styles.assistant.backgroundColor;
        const aiBorder = styles.assistant.border;
        console.log(`AI message background: ${aiBg}`);
        console.log(`AI message border: ${aiBorder}`);
        
        const isWhiteBg = aiBg.includes('255, 255, 255') || aiBg === 'rgba(0, 0, 0, 0)';
        const hasBorder = aiBorder && aiBorder !== '0px none rgb(0, 0, 0)' && aiBorder.length > 15;
        
        console.log(`[#42] AI message on white background: ${isWhiteBg ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`[#42] AI message has thin border: ${hasBorder ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`[#42] AI response uses Markdown formatting: ${styles.hasMarkdown ? '✅ PASS' : '⚠️  INFO - will verify with more responses'}`);
      } else {
        console.log(`[#42] AI message styling: ⚠️  INFO - No AI message found yet`);
      }
      
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, '04-chat-ui.png'),
        fullPage: true 
      });
    } else {
      console.log('❌ Cannot test - no textarea found');
    }
    
    // STEP 4: Structural Analysis UI
    console.log('\n' + '='.repeat(60));
    console.log('=== STEP 4: STRUCTURAL ANALYSIS UI (#43) ===\n');
    
    console.log('Waiting for structural analysis to complete (15 seconds)...');
    await page.waitForTimeout(15000);
    
    const html4 = await page.content();
    
    const hasCollapsible = html4.includes('📝') || html4.includes('課題を記録') || 
                          html4.includes('記録しました') || html4.includes('<details');
    console.log(`[#43] Collapsible toggle for structural data: ${hasCollapsible ? '✅ PASS' : '❌ FAIL'}`);
    
    // Check if AI probing question is in white bubble
    const assistantMessages = await page.locator('[class*="assistant"], [data-role="assistant"]').count();
    console.log(`Found ${assistantMessages} assistant messages`);
    
    if (assistantMessages > 0) {
      const lastAssistantBg = await page.evaluate(() => {
        const msgs = document.querySelectorAll('[class*="assistant"], [data-role="assistant"]');
        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          return window.getComputedStyle(lastMsg).backgroundColor;
        }
        return null;
      });
      
      if (lastAssistantBg) {
        const isWhite = lastAssistantBg.includes('255, 255, 255');
        console.log(`[#43] AI probing question in white bubble (not gray box): ${isWhite ? '✅ PASS' : '❌ FAIL (bg: ${lastAssistantBg})'}`);
      }
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '05-structural-analysis.png'),
      fullPage: true 
    });
    
    // STEP 5: Mobile Responsiveness
    console.log('\n' + '='.repeat(60));
    console.log('=== STEP 5: MOBILE RESPONSIVENESS (#43) ===\n');
    
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(1000);
    
    const sidebarElements = await page.locator('[class*="sidebar"], aside, nav').count();
    console.log(`Found ${sidebarElements} sidebar elements`);
    
    const hasHamburgerIcon = await page.locator('button[class*="menu"], button[aria-label*="menu"], button:has-text("☰")').count() > 0;
    console.log(`[#43] Hamburger menu icon present: ${hasHamburgerIcon ? '✅ PASS' : '❌ FAIL'}`);
    
    if (sidebarElements > 0) {
      const sidebarHidden = await page.evaluate(() => {
        const sidebar = document.querySelector('[class*="sidebar"], aside');
        if (sidebar) {
          const style = window.getComputedStyle(sidebar);
          return style.display === 'none' || style.visibility === 'hidden';
        }
        return false;
      });
      console.log(`[#43] Sidebar hidden on mobile: ${sidebarHidden ? '✅ PASS' : '❌ FAIL'}`);
    } else {
      console.log(`[#43] Sidebar check: ⚠️  INFO - No sidebar found`);
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '06-mobile-view.png'),
      fullPage: true 
    });
    
    // STEP 6: Timeline Check
    console.log('\n' + '='.repeat(60));
    console.log('=== STEP 6: TIMELINE CHECK (#43) ===\n');
    
    // Reset to desktop view
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(1000);
    
    const html6 = await page.content();
    const hasTimeline = html6.includes('timeline') || html6.includes('履歴');
    
    const threadItems = await page.locator('[class*="thread"], [class*="conversation"], li[class*="item"]').count();
    console.log(`Found ${threadItems} potential thread items`);
    
    if (threadItems > 0) {
      const threadTexts = await page.evaluate(() => {
        const items = document.querySelectorAll('[class*="thread"], [class*="conversation"], li[class*="item"]');
        return Array.from(items).slice(0, 3).map((item: any) => item.textContent?.substring(0, 100));
      });
      
      const hasStructuralSummaries = threadTexts.some((text: string) => 
        text && (text.includes('課題') || text.includes('問題') || text.includes('疑問'))
      );
      
      console.log(`[#43] Timeline shows structural summaries (not raw text): ${hasStructuralSummaries ? '✅ PASS' : '⚠️  INFO - cannot verify'}`);
      console.log(`Thread preview samples:`);
      threadTexts.forEach((text: string, i: number) => {
        console.log(`  ${i + 1}. ${text?.substring(0, 60)}...`);
      });
    } else {
      console.log(`[#43] Timeline check: ⚠️  INFO - No thread items found yet`);
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '07-timeline.png'),
      fullPage: true 
    });
    
  } catch (error) {
    console.error('\n❌ Error during testing:', error);
  } finally {
    console.log('\n' + '='.repeat(60));
    console.log('TEST EXECUTION COMPLETED');
    console.log('='.repeat(60));
    console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}`);
    console.log('\nLegend:');
    console.log('  ✅ PASS - Feature working as expected');
    console.log('  ❌ FAIL - Feature not working as expected');
    console.log('  ⚠️  INFO - Unable to verify (needs more data or auth)');
    
    await browser.close();
  }
}

runTests();
