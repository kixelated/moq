import 'solid-js';

declare module 'solid-js' {
    namespace JSX {
        interface IntrinsicElements {
            'hang-publish': any; // or a better type
        }
    }
}
