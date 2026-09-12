/**
 * The Win32 numbers and struct sizes the restricted-token sandbox depends on.
 *
 * Every value here is a constant from a Windows header, and every one of them is a place where
 * being wrong is invisible: a mistyped flag does not fail to compile, it produces a token that
 * confines less than it claims. They are grouped by the header they came from and carry the name
 * that header uses, so a reader can check any of them against the SDK rather than against this
 * file's own claims.
 *
 * The struct sizes at the bottom are x64 layouts. They matter because the calls that take these
 * structs read a fixed number of bytes at fixed offsets — a wrong size is a buffer overrun on
 * somebody else's side of the boundary.
 */

// --- Token access rights (winnt.h) ---
export const TOKEN_ASSIGN_PRIMARY = 0x0001;
export const TOKEN_DUPLICATE = 0x0002;
export const TOKEN_QUERY = 0x0008;
export const TOKEN_ADJUST_DEFAULT = 0x0080;

/** Marks a token group as the logon session SID. Bit 31 is set — mind JS's signed bitwise ops. */
export const SE_GROUP_LOGON_ID = 0xc0000000;

// --- File access rights (winnt.h) ---
const STANDARD_RIGHTS_WRITE = 0x00020000;
const FILE_GENERIC_WRITE = 0x00120116;
const DELETE = 0x00010000;
const FILE_DELETE_CHILD = 0x0040;

/**
 * What a write grant actually grants.
 *
 * `READ_CONTROL` is masked out deliberately: it is bundled into `FILE_GENERIC_WRITE` and it lets
 * the holder read the object's security descriptor. The capability is about writing, and handing
 * out the ability to read ACLs alongside it would widen the grant past what it says.
 */
export const GRANT_MASK = (FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD) & ~STANDARD_RIGHTS_WRITE;

/** Full access, used only for the token's own default DACL. */
export const FILE_ALL_ACCESS = 0x1f01ff;

// --- CreateRestrictedToken flags (securitybaseapi.h) ---
/** Strip maximum-privilege elevation so the confined child cannot escalate. */
export const DISABLE_MAX_PRIVILEGE = 0x1;
/** Produce a limited-user (filtered admin) token. */
export const LUA_TOKEN = 0x4;
/** The mechanism itself: writes are also checked against the restricting SID list. */
export const WRITE_RESTRICTED = 0x8;

// --- Well-known SIDs and token info classes ---
/** `S-1-1-0`, Everyone. */
export const WinWorldSid = 1;
export const TokenGroups = 2;
export const TokenDefaultDacl = 6;

// --- ACL / trustee (accctrl.h, aclapi.h) ---
export const DACL_SECURITY_INFORMATION = 0x00000004;
/*
 * 这张表里有几个常量没有调用点，留着是有意的。
 *
 * 它照着 Windows 的头文件抄，作用一半是给 `koffi` 用、一半是让下一个读这个文件的人不必去翻
 * `aclapi.h`。`GRANT_ACCESS = 1` 旁边缺了 `REVOKE_ACCESS = 4`，读的人不会以为「不需要」，会以为
 * 「是不是抄漏了」——然后去翻头文件确认。一个完整的枚举比一个精简的枚举省事。
 *
 * 没有 `export`（`knip` 会说没人用，它说得对），所以下面几行各自压一条 oxlint 的未用告警。
 */
export const SE_FILE_OBJECT = 1;
export const TRUSTEE_IS_UNKNOWN = 0;
export const TRUSTEE_IS_SID = 0;
export const NO_MULTIPLE_TRUSTEE = 0;
export const GRANT_ACCESS = 1;
// oxlint-disable-next-line no-unused-vars -- 见上面那段：这张表要完整
const REVOKE_ACCESS = 4;
/** `OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE` — the grant reaches the whole tree. */
export const SUB_CONTAINERS_AND_OBJECTS_INHERIT = 0x3;
// oxlint-disable-next-line no-unused-vars -- 见上面那段：这张表要完整
const ACCESS_ALLOWED_ACE_TYPE = 0;
// oxlint-disable-next-line no-unused-vars -- 见上面那段：这张表要完整
const INHERITED_ACE = 0x10;

// --- Process / handle (processthreadsapi.h, winbase.h) ---
export const PROCESS_QUERY_INFORMATION = 0x0400;
export const STARTF_USESTDHANDLES = 0x00000100;
// oxlint-disable-next-line no-unused-vars -- 见上面那段：这张表要完整
const HANDLE_FLAG_INHERIT = 0x1;
export const INFINITE = 0xffffffff;
export const STD_INPUT_HANDLE = -10;
export const STD_OUTPUT_HANDLE = -11;
export const STD_ERROR_HANDLE = -12;

// --- Errors ---
export const ERROR_SUCCESS = 0;
export const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000;
export const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200;

// --- Sizes and offsets, x64 ---
/** Largest a SID can be. */
export const SECURITY_MAX_SID_SIZE = 68;
/** `SID_AND_ATTRIBUTES`: pointer + DWORD + padding. */
export const SID_AND_ATTRIBUTES_SIZE = 16;
/** Where `TOKEN_GROUPS.Groups` starts, after the DWORD count and its padding. */
export const TOKEN_GROUPS_OFFSET = 8;
/** `EXPLICIT_ACCESS_W`. */
export const EXPLICIT_ACCESS_W_SIZE = 48;
/** Where the embedded `TRUSTEE_W` starts inside it. */
export const TRUSTEE_W_OFFSET = 16;
/** Where `TRUSTEE_W.ptstrName` — the SID pointer — sits inside the trustee. */
export const TRUSTEE_W_PTSTRNAME_OFFSET = 24;
/** `STARTUPINFOW`. */
export const STARTUPINFOW_SIZE = 104;
/** `PROCESS_INFORMATION`. */
export const PROCESS_INFORMATION_SIZE = 24;
