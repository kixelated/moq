import { PublishButtonProps } from './publish-types';

interface NothingSourceButtonProps extends PublishButtonProps {}

export default function NothingSourceButton(props: NothingSourceButtonProps) {
    return (
        <div class="publishSourceButtonContainer">
            <button
                title="No Source"
                class={`publishSourceButton ${props.isActive ? 'active' : ''}`}
                onClick={props.onClick}
            >
                🚫
            </button>
        </div>
    );
}
