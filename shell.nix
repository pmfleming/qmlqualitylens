{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [
    pkgs.nodejs
    pkgs.qt6.qtdeclarative
  ];

  shellHook = ''
    export QT_QPA_PLATFORM=offscreen
    export QML_IMPORT_PATH="${pkgs.qt6.qtdeclarative}/lib/qt-6/qml''${QML_IMPORT_PATH:+:}$QML_IMPORT_PATH"
    export QML2_IMPORT_PATH="${pkgs.qt6.qtdeclarative}/lib/qt-6/qml''${QML2_IMPORT_PATH:+:}$QML2_IMPORT_PATH"
    echo "qmlqualitylens Qt oracle environment"
    echo "  node: $(node --version 2>/dev/null || true)"
    echo "  qmllint: $(qmllint --version 2>/dev/null || true)"
    echo "  QT_QPA_PLATFORM=$QT_QPA_PLATFORM"
  '';
}
