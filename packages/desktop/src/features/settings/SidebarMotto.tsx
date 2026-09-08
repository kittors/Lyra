import { translate } from "../../i18n/translate.ts";
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
			<SectionTitle>{translate("motto.title")}</SectionTitle>
			<Card className="p-3.5">
				<div className="flex items-center gap-2">
					<TextInput value={draft} onChange={setDraft} placeholder={translate("motto.placeholder")} aria-label={translate("motto.title")} maxLength={500} />
					<IconButton disabled={saving || draft === stored} label={translate("motto.save")} onClick={() => void save(draft)} icon={<Save size={15} strokeWidth={1.8} />} />
					<IconButton disabled={saving || (!stored && !draft)} label={translate("motto.restore")} onClick={() => void save("")} icon={<RotateCcw size={15} strokeWidth={1.8} />} />
				</div>
			</Card>
		</section>
	);
}
