/**
 * Toggle button component for showing/hiding stats panel
 * @module components/ToggleButton
 */

interface ToggleButtonProps {
    isVisible: boolean;
    onToggle: (value: boolean) => void;
    icon: string;
}

export const Button = (props: ToggleButtonProps) => {
    return (
        <button
            class="stats__toggle"
            onClick={() => props.onToggle(!props.isVisible)}
            title={props.isVisible ? "Hide stats" : "Show stats"}
            aria-label={props.isVisible ? "Hide stats" : "Show stats"}
            aria-pressed={props.isVisible}
        >
            <div class="stats__icon" innerHTML={props.icon} />
        </button>
    );
};
