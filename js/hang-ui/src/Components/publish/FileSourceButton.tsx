import { createSignal, useContext } from "solid-js";
import { PublishControlsContext } from "./PublishControlsContextProvider";

export default function FileSourceButton() {
	const [fileInputRef, setFileInputRef] = createSignal<HTMLInputElement | undefined>();
	const context = useContext(PublishControlsContext);
	const onClick = () => fileInputRef()?.click();
	const onChange = (event: Event) => {
		const castedInputEl = event.target as HTMLInputElement;
		const file = castedInputEl.files?.[0];

		if (file) {
			context?.setFile(file);
			castedInputEl.value = "";
		}
	};

	return (
		<>
			<input
				ref={setFileInputRef}
				onClick={onClick}
				onChange={onChange}
				type="file"
				class="hidden"
				accept="video/*,audio/*,image/*"
			></input>
			<button
				type="button"
				title="Upload File"
				onClick={onClick}
				class={`publishSourceButton ${context?.fileActive?.() ? "active" : ""}`}
			>
				📁
			</button>
		</>
	);
}
