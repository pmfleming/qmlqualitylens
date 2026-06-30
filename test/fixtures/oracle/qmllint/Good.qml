import QtQuick 2.15

Item {
    id: root
    property int count: 1

    Rectangle {
        id: box
        width: root.count * 2
        height: 10
    }
}
