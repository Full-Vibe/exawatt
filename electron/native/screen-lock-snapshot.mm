// Read-only startup/resume capability. CGSessionCopyCurrentDictionary is a
// public API; CGSSessionScreenIsLocked is an optional, undocumented field.
// Missing dictionaries, fields, and non-booleans are unknown, never unlock.
// Electron's macOS idle monitor caches future notifications, so it cannot
// establish whether the session was already locked when the process started.
#include <CoreGraphics/CGSession.h>
#include <node_api.h>

namespace {

napi_value Read(napi_env env, napi_callback_info) {
  const char* answer = "unknown";
  CFDictionaryRef session = CGSessionCopyCurrentDictionary();
  if (session != nullptr) {
    CFTypeRef locked =
        CFDictionaryGetValue(session, CFSTR("CGSSessionScreenIsLocked"));
    if (locked != nullptr && CFGetTypeID(locked) == CFBooleanGetTypeID()) {
      answer = CFBooleanGetValue(static_cast<CFBooleanRef>(locked))
                   ? "locked"
                   : "unlocked";
    }
    CFRelease(session);
  }
  napi_value result;
  if (napi_create_string_utf8(env, answer, NAPI_AUTO_LENGTH, &result) != napi_ok)
    return nullptr;
  return result;
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
