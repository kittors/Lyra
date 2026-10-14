/**
 * 保险箱，对外的那一面：对话里的凭据卡片要用的输入框和说法。
 *
 * 页面本身（`VaultView`）不在这里，理由和设置页一样：它只由 `app/screens.tsx` 懒加载，放进出口
 * 会让它多一条静态引用路径，整个域被并回主 chunk。
 */

export { CredentialFields, type CredentialValues } from "./CredentialFields.tsx";
export { KIND_ICON, KIND_LABEL, PROBLEM_LABEL } from "./labels.ts";
