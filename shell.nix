{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [
    pkgs.nodejs
    pkgs.cmake
    pkgs.ninja
    pkgs.qt6.qtbase
    pkgs.qt6.qtdeclarative
  ];

  shellHook = ''
    export QT_QPA_PLATFORM=offscreen
    export QML_IMPORT_PATH="${pkgs.qt6.qtdeclarative}/lib/qt-6/qml''${QML_IMPORT_PATH:+:}$QML_IMPORT_PATH"
    export QML2_IMPORT_PATH="${pkgs.qt6.qtdeclarative}/lib/qt-6/qml''${QML2_IMPORT_PATH:+:}$QML2_IMPORT_PATH"
    export QT_QUICK_BACKEND=software
    echo "qmlqualitylens CMake/Qt integration environment"
    echo "  node: $(node --version 2>/dev/null || true)"
    echo "  qmllint: $(qmllint --version 2>/dev/null || true)"
    echo "  cmake: $(cmake --version 2>/dev/null | head -n 1)"
    echo "  ninja: $(ninja --version 2>/dev/null || true)"
    echo "  QT_QPA_PLATFORM=$QT_QPA_PLATFORM"
  '';
}
