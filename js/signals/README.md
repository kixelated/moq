# Signals
Reactive and safe signals.

TODO More docs.

## Why?
SolidJS signals are nice, but there's too much magic.
It's very easy to shoot yourself in the foot by calling Accessors from outside of an effect.
The current execution context is difficult to track and there's many unintuitive edge cases.

React signals require explicit dependencies.
I don't want to list all of the signals that *might* be used in an effect.
I would much rather just run the function and record what signals were used, re-running it on change.
