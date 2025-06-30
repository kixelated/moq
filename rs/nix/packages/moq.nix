{ lib, fenix, naersk }: system:
let
  rust = with fenix.packages.${system}; combine [
    stable.rustc
    stable.cargo
    stable.clippy
    stable.rustfmt
    targets.wasm32-unknown-unknown.stable.rust-std
  ];

  naersk' = naersk.lib.${system}.override {
    cargo = rust;
    rustc = rust;
  };
in
{
  moq-relay = naersk'.buildPackage {
    pname = "moq-relay";
    src = ../../.;
  };

  moq-clock = naersk'.buildPackage {
    pname = "moq-clock";
    src = ../../.;
  };

  hang = naersk'.buildPackage {
    pname = "hang";
    src = ../../.;
  };
}