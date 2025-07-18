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
        cargoBuildOptions =
          opts:
          opts
          ++ [
            "-p"
            "moq-relay"
          ];
        cargoTestOptions =
          opts:
          opts
          ++ [
            "-p"
            "moq-relay"
          ];
      };

      moq-clock = naersk'.buildPackage {
        pname = "moq-clock";
        src = ../../.;
        cargoBuildOptions =
          opts:
          opts
          ++ [
            "-p"
            "moq-clock"
          ];
        cargoTestOptions =
          opts:
          opts
          ++ [
            "-p"
            "moq-clock"
          ];
      };

      moq-token = naersk'.buildPackage {
        pname = "moq-token-cli";
        src = ../../.;
        cargoBuildOptions =
          opts:
          opts
          ++ [
            "-p"
            "moq-token-cli"
          ];
        cargoTestOptions =
          opts:
          opts
          ++ [
            "-p"
            "moq-token-cli"
          ];
      };

      hang = naersk'.buildPackage {
        pname = "hang";
        src = ../../.;
        cargoBuildOptions =
          opts:
          opts
          ++ [
            "-p"
            "hang"
          ];
        cargoTestOptions =
          opts:
          opts
          ++ [
            "-p"
            "hang"
          ];
      };
    };
  }
)
