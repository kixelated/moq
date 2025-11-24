import { PublishButtonProps } from './publish-types';

interface ScreenPublishSourceButtonProps extends PublishButtonProps {}

export default function ScreenSourceButton(
    props: ScreenPublishSourceButtonProps
) {
    return (
        <div class="publishSourceButtonContainer">
            <button
                title="Screen"
                class={`publishSourceButton ${props.isActive ? 'active' : ''}`}
                onClick={props.onClick}
            >
                🖥️
            </button>
        </div>
    );
}
