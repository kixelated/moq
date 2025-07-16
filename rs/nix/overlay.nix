final: prev:
let
  fenix = builtins.getFlake "github:nix-community/fenix";
  naersk = builtins.getFlake "github:nmattia/naersk";

  rust =
    with fenix.packages.${final.system};
    combine [
      stable.rustc
      stable.cargo
      stable.clippy
      stable.rustfmt
    ];

  naersk' = naersk.lib.${final.system}.override {
    cargo = rust;
    rustc = rust;
  };
in
{
  moq-relay = naersk'.buildPackage {
    pname = "moq-relay";
    src = ../.;
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
    src = ../.;
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

  hang = naersk'.buildPackage {
    pname = "hang";
    src = ../.;
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

  moq-token = naersk'.buildPackage {
    pname = "moq-token-cli";
    src = ../.;
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
}
