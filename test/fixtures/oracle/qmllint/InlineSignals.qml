import QtQuick 2.15

Item {
    Item { id: backend; signal ready() }
    Connections {
        target: backend
        function onReady() {}
    }
}
