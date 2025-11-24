import { createSignal } from 'solid-js';

type MediaSourceSelectorProps = {
    isActive: boolean;
    sources?: MediaDeviceInfo[];
    onSelected?: (sourceId: string) => void;
};

export default function MediaSourceSourceSelector({
    isActive,
    sources,
    onSelected,
}: MediaSourceSelectorProps) {
    const [sourcesVisible, setSourcesVisible] = createSignal(false);

    const toggleSourcesVisible = () => {
        if (sourcesVisible()) {
            setSourcesVisible(false);
        } else {
            setSourcesVisible(true);
        }
    };

    return (
        isActive &&
        sources?.length && (
            <>
                <span
                    onClick={toggleSourcesVisible}
                    class="mediaSourceVisibilityToggle"
                >
                    {sourcesVisible() ? '▼' : '▲'}
                </span>
                {sourcesVisible() && (
                    <select
                        class="mediaSourceSelector"
                        onChange={(e) => onSelected?.(e.currentTarget.value)}
                    >
                        {sources.map((source) => (
                            <option value={source.deviceId}>
                                {source.label}
                            </option>
                        ))}
                    </select>
                )}
            </>
        )
    );
}
