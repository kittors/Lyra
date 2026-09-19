import { Pin, PinOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { ToolbarButton } from "./WindowControls.tsx";

export function KeepOnTopButton() {
	const { t } = useI18n();
	const [enabled, setEnabled] = useState(false);
	const [pending, setPending] = useState(false);
	useEffect(() => {
		void bridge.windows.keepOnTop().then((result) => { if (result.ok) setEnabled(result.enabled); });
	}, []);
	return <ToolbarButton label={t(enabled ? "window.releaseTop" : "window.keepOnTop")} active={enabled} onClick={async () => {
		if (pending) return;
		setPending(true);
		try {
			const result = await bridge.windows.keepOnTop({ enabled: !enabled });
			if (result.ok) setEnabled(result.enabled);
		} finally {
			setPending(false);
		}
	}}>
		<span data-ly-keep-on-top={enabled ? "true" : "false"} className="flex items-center justify-center">
			{enabled ? <PinOff size={13} strokeWidth={1.9} /> : <Pin size={13} strokeWidth={1.9} />}
		</span>
	</ToolbarButton>;
}
