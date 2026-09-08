import { RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Card, SectionTitle, TextInput } from "./controls.tsx";

export function SidebarMotto() {
	const settings = useApp((state) => state.settings);
	const saveSettings = useApp((state) => state.saveSettings);
	const stored = settings?.personalization?.sidebarMotto ?? "";
	const [draft, setDraft] = useState(stored);
	const [saving, setSaving] = useState(false);
	useEffect(() => setDraft(stored), [stored]);
	const save = async (text: string) => {
		if (!settings) return;
		setSaving(true);
		try {
			await saveSettings({ ...settings, personalization: { ...settings.personalization, sidebarMotto: text.trim() } });
			setDraft(text.trim());
		} catch (error) { useApp.getState().notify(String(error), "error"); } finally {
			setSaving(false);
		}
	};
	return (
		<section>
			<SectionTitle>侧边栏座右铭</SectionTitle>
			<Card className="p-3.5">
				<div className="flex items-center gap-2">
					<TextInput value={draft} onChange={setDraft} placeholder="写一句喜欢的话，留空显示模型供应商" aria-label="侧边栏座右铭" maxLength={500} />
					<IconButton disabled={saving || draft === stored} label="保存座右铭" onClick={() => void save(draft)} icon={<Save size={15} strokeWidth={1.8} />} />
					<IconButton disabled={saving || (!stored && !draft)} label="恢复默认座右铭" onClick={() => void save("")} icon={<RotateCcw size={15} strokeWidth={1.8} />} />
				</div>
			</Card>
		</section>
	);
}
