/**
 * ModalShell — overlay + centered card + ESC + click-outside.
 * Body padding is left to the caller so dialogs that need flush headers
 * (e.g. cover gradients) can opt out.
 */

import { type CSSProperties, type ReactNode, useEffect } from "react";

export interface ModalShellProps {
	children: ReactNode;
	onCancel: () => void;
	width: number;
	/** Body className override; defaults to `"p-6"`. Pass `""` to opt out. */
	bodyClassName?: string;
	/** Optional inline style merged onto the inner card (e.g. maxHeight). */
	bodyStyle?: CSSProperties;
}

export function ModalShell({
	children,
	onCancel,
	width,
	bodyClassName = "p-6",
	bodyStyle,
}: ModalShellProps) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onCancel]);
	return (
		<div className="bn-anim-fade-in fixed inset-0 z-[300] flex items-center justify-center">
			<button
				type="button"
				aria-label="关闭弹窗"
				onClick={onCancel}
				className="absolute inset-0 cursor-default border-0 bg-black/35 backdrop-blur-[4px]"
			/>
			<div
				role="dialog"
				aria-modal="true"
				className={`relative overflow-hidden rounded-[14px] bg-white ${bodyClassName}`}
				style={{
					width,
					boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
					...bodyStyle,
				}}
			>
				{children}
			</div>
		</div>
	);
}
