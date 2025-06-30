import "./highlight";

import HangSupport from "@kixelated/hang/support/element";
import HangWatch from "@kixelated/hang/watch/element";

export { HangWatch, HangSupport };

const watch = document.querySelector("hang-watch") as HangWatch;

// If query params are provided, use it as the broadcast name.


// ?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwYXRoIjoidGVzdC1tYWMvIiwicHViIjpudWxsLCJzdWIiOiIvdGVzdC1tYWMvKiIsInN1Yj8iOnRydWUsImV4cCI6bnVsbCwiaWF0IjpudWxsfQ.Kssxm6hltd9tAJNxT-4fW8bICs9ancrcR_IRaCkvl1w`
const urlParams = new URLSearchParams(window.location.search);
const name = urlParams.get("name") ?? "jwt-test/bbb";

// TOKENS FOR TESTING (updated for new cluster model):
// bum-subscriber.jwt (subscribe only): eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwYXRoIjoiYnVtLyIsInB1YiI6bnVsbCwic3ViIjoiIiwiZXhwIjpudWxsLCJpYXQiOm51bGx9.beFdsuOQE-re0vEfAHleJkhBLbp49nHIYwNa2Ycy2J0
// bum-publisher.jwt (publish only): eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwYXRoIjoiYnVtLyIsInB1YiI6IiIsInN1YiI6bnVsbCwiZXhwIjpudWxsLCJpYXQiOm51bGx9.9NlWwUd6MUin1iH49YnauNIHSBqhrDd22HlD42f_rCQ
// bum-unified.jwt (both publish+subscribe): eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwYXRoIjoiYnVtLyIsInB1YiI6IiIsInN1YiI6IiIsImV4cCI6bnVsbCwiaWF0IjpudWxsfQ.BtegviJ-sp0k-akB-Yd9mXMByRXp5WZWBb_2SyqNf8o

//JWT STREAM - SUBSCRIBER TOKEN (updated)
watch.setAttribute("url", `http://localhost:4443/bum/?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwYXRoIjoiYnVtLyIsInB1YiI6bnVsbCwic3ViIjoiIiwiZXhwIjpudWxsLCJpYXQiOm51bGx9.beFdsuOQE-re0vEfAHleJkhBLbp49nHIYwNa2Ycy2J0`);
watch.setAttribute("path", ``);

// ON-JWT DEMO
// watch.setAttribute("url", `http://localhost:4443/demo/`);
// watch.setAttribute("path", ``);