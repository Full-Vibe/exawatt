// Notification authorization for the host app, read and requested in process.
//
// Electron raises macOS's notification prompt as a side effect of the first
// Notification.show() and exposes no way to read the answer, so a prompt
// could neither be primed nor reflected in Settings (ENG-045). This is the
// whole native surface: two promise-returning functions over
// UNUserNotificationCenter, using N-API only so one build loads in any
// Electron version. `scripts/build-electron-native.mjs` compiles it on macOS.
//
//   read()    -> 'not-determined' | 'denied' | 'granted' | 'unavailable'
//   request() -> 'granted' | 'denied' | 'unavailable'
//
// 'unavailable' means the system could not answer (an unsigned build whose
// identity usernoted cannot validate, for one). It is never a verdict.
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>

namespace {

struct Settlement {
  napi_deferred deferred;
  napi_threadsafe_function settle;
  const char* answer;
};

// Runs on the JS thread: resolves the promise with the answer the system
// delivered on its own queue.
void Resolve(napi_env env, napi_value, void*, void* data) {
  Settlement* settlement = static_cast<Settlement*>(data);
  napi_value answer;
  napi_create_string_utf8(env, settlement->answer, NAPI_AUTO_LENGTH, &answer);
  napi_resolve_deferred(env, settlement->deferred, answer);
  napi_release_threadsafe_function(settlement->settle, napi_tsfn_release);
  delete settlement;
}

void Deliver(Settlement* settlement, const char* answer) {
  settlement->answer = answer;
  napi_call_threadsafe_function(settlement->settle, settlement,
                                napi_tsfn_blocking);
}

const char* StatusName(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusNotDetermined:
      return "not-determined";
    case UNAuthorizationStatusDenied:
      return "denied";
    case UNAuthorizationStatusAuthorized:
    case UNAuthorizationStatusProvisional:
      return "granted";
  }
  return "unavailable";
}

// Starts a promise and hands `work` the settlement that completes it.
template <typename Work>
napi_value Promised(napi_env env, const char* name, Work work) {
  napi_value promise;
  napi_deferred deferred;
  if (napi_create_promise(env, &deferred, &promise) != napi_ok) return nullptr;
  napi_value resource_name;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource_name);
  Settlement* settlement = new Settlement{deferred, nullptr, "unavailable"};
  napi_create_threadsafe_function(env, nullptr, nullptr, resource_name, 0, 1,
                                  nullptr, nullptr, nullptr, Resolve,
                                  &settlement->settle);
  @try {
    work(settlement);
  } @catch (NSException*) {
    // No bundle identity, or a center that cannot be created.
    Deliver(settlement, "unavailable");
  }
  return promise;
}

napi_value Read(napi_env env, napi_callback_info) {
  return Promised(env, "notification-authorization-read",
                  [](Settlement* settlement) {
    [[UNUserNotificationCenter currentNotificationCenter]
        getNotificationSettingsWithCompletionHandler:^(
            UNNotificationSettings* settings) {
          Deliver(settlement, StatusName(settings.authorizationStatus));
        }];
  });
}

// Raises the system prompt when the answer is still undetermined, and
// resolves once the user has answered it. A determined answer returns at once
// without prompting: macOS asks only once.
napi_value Request(napi_env env, napi_callback_info) {
  return Promised(env, "notification-authorization-request",
                  [](Settlement* settlement) {
    UNAuthorizationOptions options = UNAuthorizationOptionAlert |
                                     UNAuthorizationOptionBadge |
                                     UNAuthorizationOptionSound;
    [[UNUserNotificationCenter currentNotificationCenter]
        requestAuthorizationWithOptions:options
                      completionHandler:^(BOOL granted, NSError* error) {
                        if (error != nil) {
                          Deliver(settlement, "unavailable");
                        } else {
                          Deliver(settlement, granted ? "granted" : "denied");
                        }
                      }];
  });
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value read;
  napi_create_function(env, "read", NAPI_AUTO_LENGTH, Read, nullptr, &read);
  napi_set_named_property(env, exports, "read", read);
  napi_value request;
  napi_create_function(env, "request", NAPI_AUTO_LENGTH, Request, nullptr,
                       &request);
  napi_set_named_property(env, exports, "request", request);
  return exports;
}

}  // namespace

NAPI_MODULE(notification_authorization, Init)
