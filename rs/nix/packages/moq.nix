{
  fenix,
  naersk,
  flake-utils,
  ...
}:
flake-utils.lib.eachDefaultSystem (
  system:
  let
    rust =
      with fenix.packages.${system};
      combine [
        stable.rustc
        stable.cargo
        stable.clippy
        stable.rustfmt
      ];

    naersk' = naersk.lib.${system}.override {
      cargo = rust;
      rustc = rust;
    };
  in
  {
    packages = {
      moq-relay = naersk'.buildPackage {
        pname = "moq-relay";
        src = ../../.;
      };

      moq-clock = naersk'.buildPackage {
        pname = "moq-clock";
        src = ../../.;
      };

      moq-token = naersk'.buildPackage {
        pname = "moq-token-cli";
        src = ../../.;
      };

      hang = naersk'.buildPackage {
        pname = "hang";
        src = ../../.;
      };
    };
  }
)
