import "./highlight";

import HangSupport from "@kixelated/hang/support/element";
import HangWatch from "@kixelated/hang/watch/element";

export { HangWatch, HangSupport };

const watch = document.querySelector("hang-watch") as HangWatch;

// If query params are provided, use it as the broadcast name.


// ?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwYXRoIjoidGVzdC1tYWMvIiwicHViIjpudWxsLCJzdWIiOiIvdGVzdC1tYWMvKiIsInN1Yj8iOnRydWUsImV4cCI6bnVsbCwiaWF0IjpudWxsfQ.Kssxm6hltd9tAJNxT-4fW8bICs9ancrcR_IRaCkvl1w`
const urlParams = new URLSearchParams(window.location.search);
const name = urlParams.get("name") ?? "jwt-test/bbb";

watch.setAttribute("url", `http://localhost:4443/demo/`);
watch.setAttribute("path", ``);