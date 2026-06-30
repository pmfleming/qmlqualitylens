import QtQuick 2.15

Item {
    Target {
        id: target
    }

    Connections {
        target: target
        function onRejected() {}
    }
}
