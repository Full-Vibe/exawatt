// Read-only startup/resume facts. CGSessionCopyCurrentDictionary and the
// console/login keys are public; CGSSessionScreenIsLocked is undocumented.
// Preserve absent versus malformed values so the policy can interpret the
// observed sparse lock flag without treating an unavailable session as unlock.
#include <CoreGraphics/CGSession.h>
#include <node_api.h>

namespace {

napi_status SetFact(napi_env env, napi_value result, CFDictionaryRef session,
                    CFStringRef key, const char* name) {
  CFTypeRef fact = CFDictionaryGetValue(session, key);
  napi_value value;
  napi_status status;
  if (fact != nullptr && CFGetTypeID(fact) == CFBooleanGetTypeID()) {
    status = napi_get_boolean(
        env, CFBooleanGetValue(static_cast<CFBooleanRef>(fact)), &value);
  } else {
    status = napi_create_string_utf8(env, fact == nullptr ? "absent" : "invalid",
                                     NAPI_AUTO_LENGTH, &value);
  }
  return status == napi_ok
             ? napi_set_named_property(env, result, name, value)
             : status;
}

napi_value Read(napi_env env, napi_callback_info) {
  CFDictionaryRef session = CGSessionCopyCurrentDictionary();
  napi_value result;
  if (session == nullptr) {
    return napi_get_null(env, &result) == napi_ok ? result : nullptr;
  }
  napi_status status = napi_create_object(env, &result);
  if (status == napi_ok)
    status = SetFact(env, result, session, CFSTR("CGSSessionScreenIsLocked"),
                     "locked");
  if (status == napi_ok)
    status = SetFact(env, result, session, kCGSessionOnConsoleKey, "onConsole");
  if (status == napi_ok)
    status = SetFact(env, result, session, kCGSessionLoginDoneKey, "loginDone");
  CFRelease(session);
  return status == napi_ok ? result : nullptr;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value read;
  if (napi_create_function(env, "read", NAPI_AUTO_LENGTH, Read, nullptr, &read) !=
      napi_ok)
    return nullptr;
  if (napi_set_named_property(env, exports, "read", read) != napi_ok)
    return nullptr;
  return exports;
}

}  // namespace

NAPI_MODULE(screen_lock_snapshot, Init)
