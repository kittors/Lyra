/**
 * Under the picture: say what to change, and it goes to the picture's conversation with the picture.
 *
 * Marks come first when words are not enough — circle the hat, arrow to where it should go. The pen
 * opens the picture in the annotator; what comes back sits in the field as a small copy until it is
 * sent, and is what gets edited instead of the plain picture.
 */

import { PenLine, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { composingKey } from "../../ui/keyboard.ts";
import { ComposerSend } from "../composer/index.ts";

export function EditBar({
	marked,
	running = false,
	onAnnotate,
	onUnmark,
	onSend,
	onStop,
}: {
	/** The marked-up copy waiting to go, as a `data:` URL. */
	marked: string | null;
	/** The picture's conversation is in the middle of a turn: the button stops it, as the composer's does. */
	running?: boolean;
	onAnnotate: (event: React.MouseEvent<HTMLButtonElement>) => void;
	onUnmark: () => void;
	/** Resolves false when nothing was sent, and the words stay for another try. */
	onSend: (words: string) => Promise<boolean>;
	onStop?: () => void;
}) {
	const { t } = useI18n();
	const [words, setWords] = useState("");
	const [sending, setSending] = useState(false);
	// Marks alone are a request too: it opens in the conversation with the marked copy, for a word to be added there.
	const ready = (Boolean(words.trim()) || Boolean(marked)) && !sending;

	const send = async () => {
		if (!ready) return;
		setSending(true);
		try {
			if (await onSend(words)) setWords("");
		} finally {
			setSending(false);
		}
	};

	return (
		<form
			data-ly-gallery-edit=""
			className="ly-gallery-edit mx-auto flex w-full max-w-[600px] items-center gap-1.5 rounded-2xl border border-line bg-card py-1.5 pr-1.5 pl-2"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<button
				type="button"
				data-ly-gallery-annotate=""
				data-ly-tip={t("gallery.annotate")}
				aria-label={t("gallery.annotate")}
				onClick={onAnnotate}
				className="grid size-8 shrink-0 place-items-center rounded-xl text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
			>
				<PenLine size={16} strokeWidth={1.8} />
			</button>
			{marked && (
				<span data-ly-gallery-marked="" className="ly-enter relative shrink-0">
					<img src={marked} alt={t("gallery.marked")} className="size-8 rounded-lg object-cover ring-1 ring-line" />
					<button
						type="button"
						aria-label={t("gallery.unmark")}
						data-ly-tip={t("gallery.unmark")}
						onClick={onUnmark}
						className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-ink text-shell"
					>
						<X size={10} strokeWidth={2.4} />
					</button>
				</span>
			)}
			<input
				data-ly-gallery-words=""
				value={words}
				onChange={(event) => setWords(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") event.currentTarget.blur();
					// The page's ← → step between pictures; inside the field they move the caret.
					if (event.key === "ArrowLeft" || event.key === "ArrowRight") event.stopPropagation();
					/*
					 * Enter is taken here rather than left to the form's implicit submit, which only fires on
					 * the character Enter produces — and an IME commits its text with that same Enter. The
					 * composer decides it the same way: composing, the key belongs to the IME.
					 */
					if (event.key === "Enter") {
						event.preventDefault();
						if (!composingKey(event.nativeEvent)) void send();
					}
				}}
				placeholder={marked ? t("gallery.editMarkedPlaceholder") : t("gallery.editPlaceholder")}
				className="min-w-0 flex-1 bg-transparent px-1.5 text-body text-ink placeholder:text-ink-faint focus:outline-none"
			/>
			{/*
			 * The composer's own button, so sending reads the same in both places and stopping is where
			 * it is there. Enter while a turn runs still sends: the composer queues it behind the turn.
			 */}
			<span data-ly-gallery-send="" className="contents">
				<ComposerSend running={running} disabled={!ready} tip={t("gallery.send")} onSend={() => void send()} onStop={() => onStop?.()} />
			</span>
		</form>
	);
}
