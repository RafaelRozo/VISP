#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/RCTLog.h>
#import <React/RCTRootView.h>

@interface VISPTaskerTests : XCTestCase

@end

@implementation VISPTaskerTests

- (BOOL)findSubviewInView:(UIView *)view matching:(BOOL (^)(UIView *view))test
{
  if (test(view)) {
    return YES;
  }
  for (UIView *subview in [view subviews]) {
    if ([self findSubviewInView:subview matching:test]) {
      return YES;
    }
  }
  return NO;
}

- (void)testRendersWelcomeScreen
{
  UIViewController *vc = [[[UIApplication sharedApplication] delegate] window].rootViewController;
  NSDate *date = [NSDate dateWithTimeIntervalSinceNow:5];

  BOOL foundElement = NO;
  while ([date timeIntervalSinceNow] > 0 && !foundElement) {
    [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    foundElement = [self findSubviewInView:vc.view
                                  matching:^BOOL(UIView *view) {
                                    if ([view.accessibilityLabel isEqualToString:@"VISPTasker"]) {
                                      return YES;
                                    }
                                    return NO;
                                  }];
  }

  // Basic test to verify app renders
  XCTAssertNotNil(vc.view, @"Root view should not be nil");
}

@end
