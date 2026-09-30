{
  description = "Reproducible QML quality-lens Qt validation environment";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/567a49d1913ce81ac6e9582e3553dd90a955875f";
  outputs = { nixpkgs, ... }: {
    devShells = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ] (system: {
      default = import ./shell.nix { pkgs = import nixpkgs { inherit system; }; };
    });
  };
}
