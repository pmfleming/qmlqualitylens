import QtQuick 2.15

Item {
    id: root
    width: parent ? parent.width : 0

    Component.onCompleted: {
        width = Qt.binding(function() { return parent ? parent.width : 0 })
    }
}
