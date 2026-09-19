import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Columns2, ExternalLink } from "lucide-react";
import { useI18n } from "../../i18n/index.ts";
import { MenuItem, MenuSeparator } from "../../ui/overlay/Popover.tsx";
import { onPhone } from "../../services/index.ts";
import { openInNewWindow } from "./actions.ts";
import { splitMoves } from "./moves.ts";
import { useSplit } from "./store.ts";

const ICONS = { left: ArrowLeft, right: ArrowRight, up: ArrowUp, down: ArrowDown, topLeft: ArrowUpLeft, bottomLeft: ArrowDownLeft, topRight: ArrowUpRight, bottomRight: ArrowDownRight, newColumn: Columns2 };

export function SplitMoveItems({ sessionId, onClose, includeWindow = false }: {
	sessionId: string;
	onClose(): void;
	includeWindow?: boolean;
}) {
	const { t } = useI18n();
	const tree = useSplit((state) => state.tree);
	const moves = splitMoves(tree, sessionId);
	return <>
		{includeWindow && !onPhone() && <>
			<MenuSeparator />
			<MenuItem icon={<ExternalLink size={13} />} onClick={() => { onClose(); void openInNewWindow(sessionId); }}>
				{t("sessionMenu.newWindow")}
			</MenuItem>
		</>}
		{moves.length > 0 && <MenuSeparator />}
		{moves.map((move) => {
			const Icon = ICONS[move.name];
			return <MenuItem key={move.name} icon={<Icon size={13} />} onClick={() => {
				useSplit.getState().move(sessionId, move.name);
				onClose();
			}}>{t(`split.move.${move.name}`)}</MenuItem>;
		})}
	</>;
}
