import QtQuick 2.15

Item {
    id: root
    width: parent ? parent.width : 0

    Component.onCompleted: {
        width = 42
    }
}
