import { chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOTS_DIR = path.join(__dirname, 'test-screenshots-final');
const BASE_URL = 'http://localhost:3000';

// Test credentials
const TEST_CREDENTIALS = {
  email: 'testuser@example.com',
  password: 'TestPassword123!'
};

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function runComprehensiveTests() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  console.log('\n' + '='.repeat(70));
  console.log('  PLURA (MINDYARD) COMPREHENSIVE TEST REPORT');
  console.log('  Issues #42, #43, #44');
  console.log('='.repeat(70) + '\n');

  const results: any = {
    step1: {},
    step2: {},
    step3: {},
    step4: {},
    step5: {},
    step6: {}
  };

  try {
    // ===== STEP 1: LOGIN PAGE =====
    console.log('\n📋 STEP 1: LOGIN PAGE CHECK (#42)\n' + '-'.repeat(70));
    
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    
    const loginPageContent = await page.content();
    
    // Check forgot password link
    const hasForgotPassword = loginPageContent.includes('パスワードを忘れた') || 
                              loginPageContent.includes('パスワードを忘れた方') ||
                              loginPageContent.includes('再設定');
    
    results.step1.forgotPasswordLink = hasForgotPassword;
    console.log(`[#42] "パスワードを忘れた方" link present: ${hasForgotPassword ? '✅ PASS' : '❌ FAIL'}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '01-login-page.png'),
      fullPage: true 
    });
    
    // Login
    console.log('\n🔐 Logging in...');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button:has-text("ログイン")');
    await page.waitForTimeout(3000);
    
    const currentUrl = page.url();
    const loggedIn = !currentUrl.includes('/login');
    console.log(`Login successful: ${loggedIn ? '✅ YES' : '❌ NO'} (URL: ${currentUrl})`);
    
    if (!loggedIn) {
      console.log('\n⚠️  WARNING: Login failed. Some tests may not run correctly.');
    }
    
    // ===== STEP 2: EMPTY STATE =====
    console.log('\n\n📋 STEP 2: EMPTY STATE CHECK (#43)\n' + '-'.repeat(70));
    
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const emptyStateContent = await page.content();
    
    // Check empty state message
    const hasEmptyMessage = emptyStateContent.includes('うまく言えなくても大丈夫');
    results.step2.emptyStateMessage = hasEmptyMessage;
    console.log(`[#43] Empty state "うまく言えなくても大丈夫": ${hasEmptyMessage ? '✅ PASS' : '❌ FAIL'}`);
    
    // Check "新しい会話を始める" button
    const hasNewConvButton = emptyStateContent.includes('新しい会話を始める');
    results.step2.noNewConvButton = !hasNewConvButton;
    console.log(`[#42] "新しい会話を始める" button NOT visible: ${!hasNewConvButton ? '✅ PASS' : '❌ FAIL'}`);
    
    // Check input examples
    const hasExamples = emptyStateContent.includes('例:') || emptyStateContent.includes('例：');
    results.step2.inputExamples = hasExamples;
    console.log(`[#43] Input examples visible: ${hasExamples ? '✅ PASS' : '❌ FAIL'}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '02-empty-state.png'),
      fullPage: true 
    });
    
    // ===== STEP 3: CHAT UI =====
    console.log('\n\n📋 STEP 3: CHAT UI CHECK (#42)\n' + '-'.repeat(70));
    
    const textarea = page.locator('textarea').first();
    const textareaExists = await textarea.count() > 0;
    
    if (textareaExists) {
      console.log('✓ Textarea found');
      
      const testMessage = '今日の会議でなんか引っかかったことがあって、コスト削減の話が出たんだけど本当にそれが問題なのか疑問に思った';
      await textarea.fill(testMessage);
      console.log('✓ Message typed');
      
      // Send message
      await textarea.press('Enter');
      console.log('✓ Message sent (Enter key)');
      
      // Wait for response
      console.log('⏳ Waiting for AI response (10 seconds)...');
      await page.waitForTimeout(10000);
      
      // Check message styling
      const messageStyles = await page.evaluate(() => {
        const results: any = {
          userMessages: [],
          assistantMessages: [],
          hasMarkdown: false
        };
        
        // Find user messages
        const userSelectors = ['[class*="user"]', '[data-role="user"]'];
        userSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach((el: any) => {
            const style = window.getComputedStyle(el);
            results.userMessages.push({
              selector: sel,
              backgroundColor: style.backgroundColor,
              padding: style.padding,
              borderRadius: style.borderRadius
            });
          });
        });
        
        // Find assistant messages
        const assistantSelectors = ['[class*="assistant"]', '[data-role="assistant"]'];
        assistantSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach((el: any) => {
            const style = window.getComputedStyle(el);
            results.assistantMessages.push({
              selector: sel,
              backgroundColor: style.backgroundColor,
              border: style.border,
              borderRadius: style.borderRadius
            });
            
            // Check for markdown elements
            if (el.querySelector('strong, em, h1, h2, h3, h4, ul, ol, code, pre')) {
              results.hasMarkdown = true;
            }
          });
        });
        
        return results;
      });
      
      console.log(`\nFound ${messageStyles.userMessages.length} user messages`);
      console.log(`Found ${messageStyles.assistantMessages.length} assistant messages`);
      
      if (messageStyles.userMessages.length > 0) {
        const userBg = messageStyles.userMessages[0].backgroundColor;
        console.log(`User message background: ${userBg}`);
        
        const isLightGray = userBg.includes('243, 244, 246') || userBg.includes('rgb(243, 244, 246)');
        results.step3.userMessageBg = isLightGray;
        console.log(`[#42] User message light gray (#F3F4F6): ${isLightGray ? '✅ PASS' : `❌ FAIL (actual: ${userBg})`}`);
      } else {
        console.log(`[#42] User message styling: ⚠️  No user message found`);
      }
      
      if (messageStyles.assistantMessages.length > 0) {
        const aiBg = messageStyles.assistantMessages[0].backgroundColor;
        const aiBorder = messageStyles.assistantMessages[0].border;
        
        console.log(`AI message background: ${aiBg}`);
        console.log(`AI message border: ${aiBorder}`);
        
        const isWhiteBg = aiBg.includes('255, 255, 255') || aiBg === 'rgba(0, 0, 0, 0)';
        const hasBorder = aiBorder && !aiBorder.includes('0px') && aiBorder.length > 15;
        
        results.step3.aiMessageWhiteBg = isWhiteBg;
        results.step3.aiMessageBorder = hasBorder;
        results.step3.markdownRendering = messageStyles.hasMarkdown;
        
        console.log(`[#42] AI message white background: ${isWhiteBg ? '✅ PASS' : `❌ FAIL (actual: ${aiBg})`}`);
        console.log(`[#42] AI message has thin border: ${hasBorder ? '✅ PASS' : `❌ FAIL (actual: ${aiBorder})`}`);
        console.log(`[#42] Markdown rendering: ${messageStyles.hasMarkdown ? '✅ PASS' : '⚠️  INFO - No markdown elements yet'}`);
      } else {
        console.log(`[#42] AI message: ⚠️  No assistant message found yet`);
      }
      
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, '03-chat-ui.png'),
        fullPage: true 
      });
    } else {
      console.log('❌ No textarea found - cannot test chat UI');
    }
    
    // ===== STEP 4: STRUCTURAL ANALYSIS =====
    console.log('\n\n📋 STEP 4: STRUCTURAL ANALYSIS UI (#43)\n' + '-'.repeat(70));
    
    console.log('⏳ Waiting for structural analysis (15 seconds)...');
    await page.waitForTimeout(15000);
    
    const structuralContent = await page.content();
    
    // Check for collapsible toggle
    const hasCollapsible = structuralContent.includes('📝') || 
                          structuralContent.includes('課題を記録') ||
                          structuralContent.includes('記録しました') ||
                          structuralContent.includes('<details');
    
    results.step4.collapsibleToggle = hasCollapsible;
    console.log(`[#43] Collapsible structural data toggle: ${hasCollapsible ? '✅ PASS' : '❌ FAIL'}`);
    
    // Check AI probing question bubble color
    const probingQuestionInfo = await page.evaluate(() => {
      const assistantMsgs = document.querySelectorAll('[class*="assistant"], [data-role="assistant"]');
      if (assistantMsgs.length > 0) {
        const lastMsg = assistantMsgs[assistantMsgs.length - 1];
        const style = window.getComputedStyle(lastMsg);
        return {
          backgroundColor: style.backgroundColor,
          count: assistantMsgs.length
        };
      }
      return null;
    });
    
    if (probingQuestionInfo) {
      console.log(`Found ${probingQuestionInfo.count} assistant messages`);
      const isWhiteBubble = probingQuestionInfo.backgroundColor.includes('255, 255, 255');
      results.step4.whiteBubble = isWhiteBubble;
      console.log(`[#43] AI probing question in white bubble: ${isWhiteBubble ? '✅ PASS' : `❌ FAIL (bg: ${probingQuestionInfo.backgroundColor})`}`);
    } else {
      console.log(`[#43] AI probing question: ⚠️  No assistant messages found`);
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '04-structural-analysis.png'),
      fullPage: true 
    });
    
    // ===== STEP 5: MOBILE RESPONSIVENESS =====
    console.log('\n\n📋 STEP 5: MOBILE RESPONSIVENESS (#43)\n' + '-'.repeat(70));
    
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(1000);
    
    const mobileInfo = await page.evaluate(() => {
      const results: any = {
        hasSidebar: false,
        sidebarHidden: false,
        hasHamburger: false
      };
      
      // Check sidebar
      const sidebar = document.querySelector('[class*="sidebar"], aside, nav[class*="nav"]');
      if (sidebar) {
        results.hasSidebar = true;
        const style = window.getComputedStyle(sidebar);
        results.sidebarHidden = style.display === 'none' || 
                               style.visibility === 'hidden' ||
                               style.width === '0px';
      }
      
      // Check hamburger menu
      const hamburgerSelectors = [
        'button[class*="menu"]',
        'button[aria-label*="menu"]',
        'button[aria-label*="Menu"]',
        'button:has(svg[class*="menu"])'
      ];
      
      hamburgerSelectors.forEach(sel => {
        if (document.querySelector(sel)) {
          results.hasHamburger = true;
        }
      });
      
      return results;
    });
    
    console.log(`Sidebar found: ${mobileInfo.hasSidebar ? 'Yes' : 'No'}`);
    if (mobileInfo.hasSidebar) {
      results.step5.sidebarHidden = mobileInfo.sidebarHidden;
      console.log(`[#43] Sidebar hidden on mobile: ${mobileInfo.sidebarHidden ? '✅ PASS' : '❌ FAIL'}`);
    }
    
    results.step5.hamburgerMenu = mobileInfo.hasHamburger;
    console.log(`[#43] Hamburger menu icon present: ${mobileInfo.hasHamburger ? '✅ PASS' : '❌ FAIL'}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '05-mobile-responsive.png'),
      fullPage: true 
    });
    
    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    
    // ===== STEP 6: TIMELINE =====
    console.log('\n\n📋 STEP 6: TIMELINE CHECK (#43)\n' + '-'.repeat(70));
    
    await page.waitForTimeout(1000);
    
    const timelineInfo = await page.evaluate(() => {
      const results: any = {
        hasTimeline: false,
        threadItems: [],
        hasStructuralSummaries: false
      };
      
      // Find thread/conversation items
      const itemSelectors = [
        '[class*="thread"]',
        '[class*="conversation"]',
        'li[class*="item"]',
        '[class*="history"] li'
      ];
      
      itemSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach((item: any) => {
          const text = item.textContent?.trim().substring(0, 100);
          if (text && text.length > 5) {
            results.threadItems.push(text);
          }
        });
      });
      
      results.hasTimeline = results.threadItems.length > 0;
      
      // Check if summaries contain structural keywords
      results.hasStructuralSummaries = results.threadItems.some((text: string) =>
        text.includes('課題') || text.includes('問題') || text.includes('疑問')
      );
      
      return results;
    });
    
    console.log(`Timeline/thread items found: ${timelineInfo.threadItems.length}`);
    
    if (timelineInfo.threadItems.length > 0) {
      results.step6.hasTimeline = true;
      results.step6.structuralSummaries = timelineInfo.hasStructuralSummaries;
      
      console.log(`[#43] Timeline shows structural summaries: ${timelineInfo.hasStructuralSummaries ? '✅ PASS' : '⚠️  INFO - Cannot verify'}`);
      
      console.log('\nThread item previews:');
      timelineInfo.threadItems.slice(0, 3).forEach((text: string, i: number) => {
        console.log(`  ${i + 1}. ${text.substring(0, 60)}...`);
      });
    } else {
      console.log(`[#43] Timeline: ⚠️  No thread items found (may need existing conversations)`);
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '06-timeline.png'),
      fullPage: true 
    });
    
  } catch (error) {
    console.error('\n❌ Error during testing:', error);
  } finally {
    console.log('\n\n' + '='.repeat(70));
    console.log('  TEST SUMMARY');
    console.log('='.repeat(70) + '\n');
    
    // Print summary
    let passCount = 0;
    let failCount = 0;
    let infoCount = 0;
    
    const allResults = Object.values(results).flat();
    allResults.forEach((result: any) => {
      if (typeof result === 'boolean') {
        if (result) passCount++;
        else failCount++;
      }
    });
    
    console.log(`✅ PASS: ${passCount}`);
    console.log(`❌ FAIL: ${failCount}`);
    console.log(`⚠️  INFO: ${infoCount}`);
    console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}`);
    
    await browser.close();
  }
}

runComprehensiveTests();
