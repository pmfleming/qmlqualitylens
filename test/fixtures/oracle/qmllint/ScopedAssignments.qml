import QtQuick 2.15

Item {
    id: root
    width: parent ? parent.width : 0

    Component.onCompleted: {
        let width = 0
        width = 42
        const other = { width: 0 }
        other.width = 42
    }

    function resize(width) {
        width = 42
    }
}
