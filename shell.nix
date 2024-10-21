# shell.nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.git         # Git version control system
    pkgs.nodejs      # Node.js runtime
    pkgs.typescript  # TypeScript compiler
    pkgs.act         # Github actions local run
  ];

  # Optionally, you can set environment variables or add shell hooks if needed.
  shellHook = ''
    echo "Nix env loaded"
  '';
}
