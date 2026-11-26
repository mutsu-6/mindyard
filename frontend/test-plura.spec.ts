import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS_DIR = path.join(__dirname, 'test-screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

test.describe('PLURA (MINDYARD) Web Application Test - Issues #42, #43, #44', () => {
  
  test('Step 1: Login Page Check', async ({ page }) => {
    console.log('\n=== STEP 1: LOGIN PAGE CHECK ===');
    
    // Navigate to the application
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    
    // Take initial screenshot
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '01-initial-page.png'),
      fullPage: true 
    });
    
    // Check current URL
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    // Check if on login page
    const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/auth');
    
    if (isLoginPage) {
      console.log('✓ Redirected to login page');
      
      // Check for "パスワードを忘れた方" link (#42)
      const forgotPasswordLink = page.locator('text=パスワードを忘れた方');
      const forgotPasswordExists = await forgotPasswordLink.count() > 0;
      
      console.log(`#42 - Forgot password link exists: ${forgotPasswordExists ? 'PASS ✓' : 'FAIL ✗'}`);
      
      // Take login page screenshot
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, '02-login-page.png'),
        fullPage: true 
      });
    } else {
      console.log('⚠ Not redirected to login page - may already be authenticated');
      console.log(`#42 - Check skipped (not on login page)`);
    }
  });

  test('Step 2: Empty State Check (#43)', async ({ page }) => {
    console.log('\n=== STEP 2: EMPTY STATE CHECK (#43) ===');
    
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    
    // Wait for main content to load
    await page.waitForTimeout(2000);
    
    // Check for empty state message
    const emptyStateMessage = page.locator('text=うまく言えなくても大丈夫');
    const emptyStateExists = await emptyStateMessage.count() > 0;
    console.log(`#43 - Empty state message "うまく言えなくても大丈夫": ${emptyStateExists ? 'PASS ✓' : 'FAIL ✗'}`);
    
    // Check for "新しい会話を始める" button (should NOT be visible before conversation)
    const newConversationButton = page.locator('text=新しい会話を始める');
    const newConvButtonExists = await newConversationButton.count() > 0;
    console.log(`#42 - "新しい会話を始める" button NOT visible before conversation: ${!newConvButtonExists ? 'PASS ✓' : 'FAIL ✗'}`);
    
    // Look for input examples
    const pageContent = await page.content();
    const hasInputExamples = pageContent.includes('例:') || pageContent.includes('例：');
    console.log(`#43 - Input examples visible: ${hasInputExamples ? 'PASS ✓' : 'FAIL ✗'}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '03-empty-state.png'),
      fullPage: true 
    });
  });

  test('Step 3: Chat UI Check (#42)', async ({ page }) => {
    console.log('\n=== STEP 3: CHAT UI CHECK (#42) ===');
    
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Find input field and type a message
    const inputField = page.locator('textarea, input[type="text"]').first();
    await inputField.waitFor({ state: 'visible', timeout: 5000 });
    
    const testMessage = '今日の会議でなんか引っかかったことがあって、コスト削減の話が出たんだけど本当にそれが問題なのか疑問に思った';
    await inputField.fill(testMessage);
    
    // Find and click send button
    const sendButton = page.locator('button[type="submit"], button:has-text("送信")').first();
    await sendButton.click();
    
    console.log('✓ Message sent');
    
    // Wait for AI response
    await page.waitForTimeout(3000);
    
    // Check for user message styling
    const userMessages = page.locator('[class*="user"], [data-role="user"]');
    const userMessageCount = await userMessages.count();
    
    if (userMessageCount > 0) {
      const userMessage = userMessages.first();
      const bgColor = await userMessage.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });
      console.log(`User message background color: ${bgColor}`);
      
      // Check if it's light gray (rgb(243, 244, 246) = #F3F4F6)
      const isLightGray = bgColor.includes('243, 244, 246') || bgColor.includes('rgb(243, 244, 246)');
      console.log(`#42 - User message background is light gray (#F3F4F6): ${isLightGray ? 'PASS ✓' : 'FAIL ✗ (actual: ${bgColor})'}`);
    }
    
    // Check for AI message styling
    const aiMessages = page.locator('[class*="assistant"], [data-role="assistant"]');
    const aiMessageCount = await aiMessages.count();
    
    if (aiMessageCount > 0) {
      const aiMessage = aiMessages.first();
      const bgColor = await aiMessage.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });
      const border = await aiMessage.evaluate((el) => {
        return window.getComputedStyle(el).border;
      });
      
      console.log(`AI message background color: ${bgColor}`);
      console.log(`AI message border: ${border}`);
      
      const isWhiteBg = bgColor.includes('255, 255, 255') || bgColor.includes('rgb(255, 255, 255)');
      const hasBorder = border !== 'none' && border.length > 0;
      
      console.log(`#42 - AI message on white background: ${isWhiteBg ? 'PASS ✓' : 'FAIL ✗'}`);
      console.log(`#42 - AI message has thin border: ${hasBorder ? 'PASS ✓' : 'FAIL ✗'}`);
      
      // Check for Markdown rendering
      const hasMarkdownElements = await page.locator('h1, h2, h3, strong, em, ul, ol').count() > 0;
      console.log(`#42 - AI response uses Markdown formatting: ${hasMarkdownElements ? 'PASS ✓' : 'FAIL ✗'}`);
    } else {
      console.log('⚠ No AI message found yet - may need more time');
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '04-chat-ui.png'),
      fullPage: true 
    });
  });

  test('Step 4: Structural Analysis UI (#43)', async ({ page }) => {
    console.log('\n=== STEP 4: STRUCTURAL ANALYSIS UI (#43) ===');
    
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Send a message first
    const inputField = page.locator('textarea, input[type="text"]').first();
    await inputField.waitFor({ state: 'visible', timeout: 5000 });
    await inputField.fill('今日の会議で気になることがあった');
    
    const sendButton = page.locator('button[type="submit"], button:has-text("送信")').first();
    await sendButton.click();
    
    // Wait for structural analysis to complete
    console.log('Waiting for structural analysis (up to 15 seconds)...');
    await page.waitForTimeout(15000);
    
    // Check for probing question in white bubble (not gray box)
    const aiMessages = page.locator('[class*="assistant"], [data-role="assistant"]');
    const aiMessageCount = await aiMessages.count();
    
    if (aiMessageCount > 0) {
      const lastAiMessage = aiMessages.last();
      const bgColor = await lastAiMessage.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });
      
      const isWhiteBubble = bgColor.includes('255, 255, 255');
      console.log(`#43 - AI probing question in white bubble (not gray box): ${isWhiteBubble ? 'PASS ✓' : 'FAIL ✗'}`);
    }
    
    // Check for collapsible toggle like "📝 課題を記録しました"
    const collapsibleToggle = page.locator('text=/📝|課題を記録しました|記録しました/');
    const hasCollapsible = await collapsibleToggle.count() > 0;
    console.log(`#43 - Collapsible toggle for structural data: ${hasCollapsible ? 'PASS ✓' : 'FAIL ✗'}`);
    
    if (hasCollapsible) {
      console.log('✓ Found collapsible structural data toggle');
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '05-structural-analysis.png'),
      fullPage: true 
    });
  });

  test('Step 5: Mobile Responsiveness (#43)', async ({ page }) => {
    console.log('\n=== STEP 5: MOBILE RESPONSIVENESS (#43) ===');
    
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Check if sidebar is hidden
    const sidebar = page.locator('[class*="sidebar"], aside, [role="navigation"]');
    const sidebarCount = await sidebar.count();
    
    if (sidebarCount > 0) {
      const isVisible = await sidebar.first().isVisible();
      console.log(`#43 - Sidebar hidden on mobile: ${!isVisible ? 'PASS ✓' : 'FAIL ✗'}`);
    }
    
    // Check for hamburger menu icon
    const hamburgerIcon = page.locator('button:has([class*="menu"]), button:has-text("☰")');
    const hasHamburger = await hamburgerIcon.count() > 0;
    console.log(`#43 - Hamburger menu icon present: ${hasHamburger ? 'PASS ✓' : 'FAIL ✗'}`);
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '06-mobile-view.png'),
      fullPage: true 
    });
  });

  test('Step 6: Timeline Check (#43)', async ({ page }) => {
    console.log('\n=== STEP 6: TIMELINE CHECK (#43) ===');
    
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Send a message to create timeline entry
    const inputField = page.locator('textarea, input[type="text"]').first();
    await inputField.waitFor({ state: 'visible', timeout: 5000 });
    await inputField.fill('テストメッセージ');
    
    const sendButton = page.locator('button[type="submit"], button:has-text("送信")').first();
    await sendButton.click();
    await page.waitForTimeout(3000);
    
    // Look for timeline/sidebar
    const timeline = page.locator('[class*="timeline"], [class*="sidebar"], aside');
    const timelineExists = await timeline.count() > 0;
    
    if (timelineExists) {
      console.log('✓ Timeline/sidebar found');
      
      // Check for thread items
      const threadItems = page.locator('[class*="thread"], [class*="conversation"]');
      const threadCount = await threadItems.count();
      console.log(`Found ${threadCount} thread items`);
      
      if (threadCount > 0) {
        const firstThread = threadItems.first();
        const threadText = await firstThread.textContent();
        
        // Check if it shows structural summaries (not raw text)
        const hasStructuralSummary = threadText && (
          threadText.includes('課題') ||
          threadText.includes('問題') ||
          threadText.length < 50 // Summaries should be shorter than raw messages
        );
        
        console.log(`#43 - Thread items show structural summaries: ${hasStructuralSummary ? 'PASS ✓' : 'FAIL ✗'}`);
        console.log(`Thread preview: ${threadText?.substring(0, 100)}`);
      } else {
        console.log('⚠ No thread items found yet');
      }
    } else {
      console.log('⚠ Timeline/sidebar not found');
    }
    
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '07-timeline.png'),
      fullPage: true 
    });
  });

  test.afterAll(async () => {
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);
    console.log('\nTest execution completed. Review screenshots for visual verification.');
  });
});
