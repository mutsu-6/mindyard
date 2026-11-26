import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS_DIR = path.join(__dirname, 'test-screenshots');
const BASE_URL = 'http://localhost:3000';

// Test credentials - we'll try to register a new user
const TEST_USER = {
  email: `test-${Date.now()}@example.com`,
  password: 'TestPassword123!'
};

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Helper function to login or register
async function ensureLoggedIn(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  
  const currentUrl = page.url();
  
  // If we're on login page, try to register
  if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
    console.log('Not logged in, attempting to register new account...');
    
    // Look for registration link
    const registerLink = page.locator('text=新規登録');
    const registerExists = await registerLink.count() > 0;
    
    if (registerExists) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');
      
      // Fill registration form
      await page.fill('input[type="email"], input[name="email"]', TEST_USER.email);
      await page.fill('input[type="password"], input[name="password"]', TEST_USER.password);
      
      // Click register button
      await page.click('button[type="submit"], button:has-text("登録"), button:has-text("新規登録")');
      await page.waitForTimeout(2000);
    } else {
      console.log('Cannot find registration link, trying to login directly');
      // Try to login with default credentials
      await page.fill('input[type="email"], input[name="email"]', 'test@example.com');
      await page.fill('input[type="password"], input[name="password"]', 'password');
      await page.click('button:has-text("ログイン")');
      await page.waitForTimeout(2000);
    }
  }
}

test.describe('PLURA (MINDYARD) Web Application Test - Issues #42, #43, #44', () => {
  
  test('Step 1: Login Page Check (#42)', async ({ page }) => {
    console.log('\n=== STEP 1: LOGIN PAGE CHECK (#42) ===');
    
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '01-initial-page.png'),
      fullPage: true 
    });
    
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/auth');
    
    if (isLoginPage) {
      console.log('✓ Redirected to login page');
      
      // Check for "パスワードを忘れた方" link (#42)
      const forgotPasswordText = await page.content();
      const hasForgotPassword = forgotPasswordText.includes('パスワードを忘れた') || 
                                forgotPasswordText.includes('パスワードを忘れた方') ||
                                forgotPasswordText.includes('再設定');
      
      console.log(`#42 - "パスワードを忘れた方" link exists: ${hasForgotPassword ? 'PASS ✓' : 'FAIL ✗'}`);
      
      if (hasForgotPassword) {
        console.log('  ✓ Found password reset link on login page');
      }
      
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, '02-login-page.png'),
        fullPage: true 
      });
    }
  });

  test('Step 2: Empty State Check (#43)', async ({ page }) => {
    console.log('\n=== STEP 2: EMPTY STATE CHECK (#43) ===');
    
    await ensureLoggedIn(page);
    await page.waitForTimeout(2000);
    
    const pageContent = await page.content();
    
    // Check for empty state message
    const hasEmptyStateMessage = pageContent.includes('うまく言えなくても大丈夫');
    console.log(`#43 - Empty state message "うまく言えなくても大丈夫": ${hasEmptyStateMessage ? 'PASS ✓' : 'FAIL ✗'}`);
    
    // Check for "新しい会話を始める" button (should NOT be visible before conversation)
    const hasNewConvButton = pageContent.includes('新しい会話を始める');
    console.log(`#42 - "新しい会話を始める" button NOT visible before conversation: ${!hasNewConvButton ? 'PASS ✓' : 'FAIL ✗'}`);
    
    // Look for input examples
    const hasInputExamples = pageContent.includes('例:') || pageContent.includes('例：');
    console.log(`#43 - Input examples visible: ${hasInputExamples ? 'PASS ✓' : 'FAIL ✗'}`);
    
    // Look for input field
    const hasTextarea = await page.locator('textarea').count() > 0;
    console.log(`  Input textarea present: ${hasTextarea ? '✓' : '✗'}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '03-empty-state.png'),
      fullPage: true 
    });
  });

  test('Step 3: Chat UI Check (#42)', async ({ page }) => {
    console.log('\n=== STEP 3: CHAT UI CHECK (#42) ===');
    
    await ensureLoggedIn(page);
    await page.waitForTimeout(2000);
    
    // Find input field
    const textarea = page.locator('textarea').first();
    const textareaExists = await textarea.count() > 0;
    
    if (!textareaExists) {
      console.log('✗ FAIL: No textarea found on the page');
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, '04-chat-ui-no-input.png'),
        fullPage: true 
      });
      return;
    }
    
    const testMessage = '今日の会議でなんか引っかかったことがあって、コスト削減の話が出たんだけど本当にそれが問題なのか疑問に思った';
    await textarea.fill(testMessage);
    console.log('✓ Message typed');
    
    // Find and click send button (try multiple selectors)
    const sendButtonSelectors = [
      'button[type="submit"]',
      'button:has-text("送信")',
      'button:has-text("送る")',
      'button[aria-label*="送信"]',
      'form button'
    ];
    
    let sentSuccessfully = false;
    for (const selector of sendButtonSelectors) {
      const button = page.locator(selector).first();
      if (await button.count() > 0) {
        await button.click();
        console.log(`✓ Clicked send button (${selector})`);
        sentSuccessfully = true;
        break;
      }
    }
    
    if (!sentSuccessfully) {
      // Try pressing Enter
      await textarea.press('Enter');
      console.log('✓ Pressed Enter to send');
    }
    
    // Wait for response
    await page.waitForTimeout(5000);
    
    // Get page HTML for analysis
    const html = await page.content();
    
    // Check for messages
    const hasUserMessage = html.includes(testMessage) || html.includes('会議');
    console.log(`  User message visible: ${hasUserMessage ? '✓' : '✗'}`);
    
    // Look for message containers
    const messageElements = await page.locator('[class*="message"], [class*="chat"], [data-role]').count();
    console.log(`  Found ${messageElements} message elements`);
    
    // Check styling using JavaScript evaluation
    if (messageElements > 0) {
      try {
        const styles = await page.evaluate(() => {
          const results: any = { user: [], assistant: [] };
          
          // Look for user messages
          const userMsgs = document.querySelectorAll('[class*="user"], [data-role="user"]');
          userMsgs.forEach((el: any) => {
            const style = window.getComputedStyle(el);
            results.user.push({
              backgroundColor: style.backgroundColor,
              border: style.border
            });
          });
          
          // Look for assistant messages
          const assistantMsgs = document.querySelectorAll('[class*="assistant"], [data-role="assistant"]');
          assistantMsgs.forEach((el: any) => {
            const style = window.getComputedStyle(el);
            results.assistant.push({
              backgroundColor: style.backgroundColor,
              border: style.border
            });
          });
          
          return results;
        });
        
        console.log('\nMessage Styling:');
        if (styles.user.length > 0) {
          const userBg = styles.user[0].backgroundColor;
          console.log(`  User message bg: ${userBg}`);
          const isLightGray = userBg.includes('243, 244, 246') || userBg.includes('rgb(243, 244, 246)');
          console.log(`  #42 - User message background is light gray (#F3F4F6): ${isLightGray ? 'PASS ✓' : 'FAIL ✗'}`);
        }
        
        if (styles.assistant.length > 0) {
          const aiBg = styles.assistant[0].backgroundColor;
          const aiBorder = styles.assistant[0].border;
          console.log(`  AI message bg: ${aiBg}`);
          console.log(`  AI message border: ${aiBorder}`);
          
          const isWhiteBg = aiBg.includes('255, 255, 255') || aiBg === 'rgba(0, 0, 0, 0)';
          const hasBorder = aiBorder && aiBorder !== 'none' && aiBorder.length > 10;
          
          console.log(`  #42 - AI message on white background: ${isWhiteBg ? 'PASS ✓' : 'FAIL ✗'}`);
          console.log(`  #42 - AI message has thin border: ${hasBorder ? 'PASS ✓' : 'FAIL ✗'}`);
        }
      } catch (error) {
        console.log('  Could not evaluate message styles');
      }
    }
    
    // Check for Markdown rendering
    const hasMarkdown = html.includes('<strong>') || html.includes('<em>') || 
                       html.includes('<h1>') || html.includes('<h2>') || 
                       html.includes('<ul>') || html.includes('<ol>');
    console.log(`#42 - AI response uses Markdown formatting: ${hasMarkdown ? 'PASS ✓' : 'INFO - will verify when response arrives'}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '04-chat-ui.png'),
      fullPage: true 
    });
  });

  test('Step 4: Structural Analysis UI (#43)', async ({ page }) => {
    console.log('\n=== STEP 4: STRUCTURAL ANALYSIS UI (#43) ===');
    
    await ensureLoggedIn(page);
    await page.waitForTimeout(2000);
    
    const textarea = page.locator('textarea').first();
    if (await textarea.count() > 0) {
      await textarea.fill('今日の会議で気になることがあった');
      await textarea.press('Enter');
      
      console.log('✓ Message sent, waiting for structural analysis (15 seconds)...');
      await page.waitForTimeout(15000);
      
      const html = await page.content();
      
      // Check for collapsible toggle
      const hasCollapsible = html.includes('📝') || html.includes('課題を記録') || 
                            html.includes('記録しました') || html.includes('details');
      console.log(`#43 - Collapsible toggle for structural data: ${hasCollapsible ? 'PASS ✓' : 'FAIL ✗'}`);
      
      // Check message structure
      const assistantMessages = await page.locator('[class*="assistant"], [data-role="assistant"]').count();
      console.log(`  Found ${assistantMessages} assistant messages`);
      
      if (hasCollapsible) {
        console.log('  ✓ Structural analysis UI detected');
      }
      
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, '05-structural-analysis.png'),
        fullPage: true 
      });
    } else {
      console.log('✗ Cannot test - no input field found');
    }
  });

  test('Step 5: Mobile Responsiveness (#43)', async ({ page }) => {
    console.log('\n=== STEP 5: MOBILE RESPONSIVENESS (#43) ===');
    
    await page.setViewportSize({ width: 375, height: 667 });
    await ensureLoggedIn(page);
    await page.waitForTimeout(2000);
    
    const html = await page.content();
    
    // Check for hamburger menu
    const hasHamburger = html.includes('☰') || html.includes('menu') || 
                        await page.locator('button[aria-label*="menu"], button[class*="menu"]').count() > 0;
    console.log(`#43 - Hamburger menu icon present: ${hasHamburger ? 'PASS ✓' : 'FAIL ✗'}`);
    
    // Check if sidebar is hidden
    const sidebarElements = await page.locator('[class*="sidebar"], aside').count();
    if (sidebarElements > 0) {
      const isHidden = await page.locator('[class*="sidebar"], aside').first().isHidden();
      console.log(`#43 - Sidebar hidden on mobile: ${isHidden ? 'PASS ✓' : 'FAIL ✗'}`);
    } else {
      console.log(`#43 - Sidebar check: INFO - No sidebar element found`);
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '06-mobile-view.png'),
      fullPage: true 
    });
  });

  test('Step 6: Timeline Check (#43)', async ({ page }) => {
    console.log('\n=== STEP 6: TIMELINE CHECK (#43) ===');
    
    await ensureLoggedIn(page);
    await page.waitForTimeout(2000);
    
    // Look for timeline/sidebar
    const html = await page.content();
    const hasTimeline = html.includes('timeline') || html.includes('履歴') || 
                       await page.locator('[class*="timeline"], [class*="history"]').count() > 0;
    
    if (hasTimeline) {
      console.log('✓ Timeline/sidebar found');
      
      // Check for thread items
      const threadElements = await page.locator('[class*="thread"], [class*="conversation"], li').count();
      console.log(`  Found ${threadElements} potential thread items`);
      
      // Look for structural summaries vs raw text
      const hasStructuralKeywords = html.includes('課題') || html.includes('問題') || html.includes('疑問');
      console.log(`#43 - Timeline shows structural summaries: ${hasStructuralKeywords ? 'PASS ✓' : 'INFO - cannot verify without data'}`);
    } else {
      console.log('INFO - Timeline/sidebar not visible or not present');
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '07-timeline.png'),
      fullPage: true 
    });
  });

  test.afterAll(async () => {
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);
    console.log('\nAll tests completed. Review screenshots for visual verification.');
  });
});
