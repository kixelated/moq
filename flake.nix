{
  description = "Top-level flake delegating to rs and js";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # js.url = "./js";  # Commented out to fix PSM build issues
    rs.url = "./rs";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      # js,  # Commented out
      rs,
      ...
    }:
    {
      nixosModules = rs.nixosModules;
      overlays = rs.overlays;
    }
    // flake-utils.lib.eachDefaultSystem (system: {
      devShells.default = nixpkgs.legacyPackages.${system}.mkShell {
        inputsFrom = [
          rs.devShells.${system}.default
          # js.devShells.${system}.default  # Commented out
        ];
        shellHook = ''
          echo "🎯 Using Gordy's Top-Level MoQ Flake (Rust environment only)"
        '';
      };
      packages = {
        inherit (rs.packages.${system}) moq-relay moq-clock hang;
      };
    });
}
