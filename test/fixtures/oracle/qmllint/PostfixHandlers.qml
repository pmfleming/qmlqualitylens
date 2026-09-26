import QtQuick

Item {
    property int count: 0
    property int doubled: width * 2
    onWidthChanged: count++
    onHeightChanged: doubled = 0
}
