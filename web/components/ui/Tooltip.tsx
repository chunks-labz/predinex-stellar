import { ReactNode, useId, useState } from 'react';

interface TooltipProps {
    content: string;
    children: ReactNode;
    position?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Tooltip - Hover/focus information component
 *
 * The trigger is focusable so helper text is reachable with a keyboard, and the
 * tooltip body is described by its trigger via `aria-describedby`. Content can
 * wrap, which matters for the longer "how payouts work" explanations.
 *
 * @param content The text to display in the tooltip
 * @param children The element that triggers the tooltip
 * @param position Tooltip position relative to children
 */
export default function Tooltip({
    content,
    children,
    position = 'top'
}: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const tooltipId = useId();

    const positionClasses = {
        top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
        bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
        left: 'right-full top-1/2 -translate-y-1/2 mr-2',
        right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    };

    const show = () => setIsVisible(true);
    const hide = () => setIsVisible(false);

    return (
        <div
            className="relative inline-block"
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocusCapture={show}
            onBlurCapture={hide}
        >
            <span aria-describedby={isVisible ? tooltipId : undefined} className="inline-flex">
                {children}
            </span>
            {isVisible && (
                <div
                    id={tooltipId}
                    role="tooltip"
                    className={`absolute z-50 w-max max-w-[min(20rem,80vw)] px-3 py-2 text-xs font-medium leading-relaxed text-white bg-black/90 backdrop-blur-md rounded-lg border border-white/10 shadow-xl animate-in fade-in zoom-in-95 duration-200 ${positionClasses[position]}`}
                >
                    {content}
                    {/* Arrow */}
                    <div className={`absolute w-2 h-2 bg-black/90 rotate-45 border-white/10 ${position === 'top' ? 'top-full left-1/2 -translate-x-1/2 -mt-1 border-r border-b' :
                            position === 'bottom' ? 'bottom-full left-1/2 -translate-x-1/2 -mb-1 border-l border-t' :
                                position === 'left' ? 'left-full top-1/2 -translate-y-1/2 -ml-1 border-r border-t' :
                                    'right-full top-1/2 -translate-y-1/2 -mr-1 border-l border-b'
                        }`} />
                </div>
            )}
        </div>
    );
}
