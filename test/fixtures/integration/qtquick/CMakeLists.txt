cmake_minimum_required(VERSION 3.21)
project(qmlqualitylens_qt_fixture VERSION 1.0 LANGUAGES CXX)

find_package(Qt6 6.4 REQUIRED COMPONENTS Qml Quick QuickTest)
qt_standard_project_setup(REQUIRES 6.4)
if(QT_KNOWN_POLICY_QTP0001)
    qt_policy(SET QTP0001 NEW)
endif()

qt_add_library(qmlqualitylens_fixture STATIC)
target_link_libraries(qmlqualitylens_fixture PRIVATE Qt6::Quick)
qt_add_qml_module(qmlqualitylens_fixture
    URI QmlQualityLens.Fixture
    VERSION 1.0
    OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/QmlQualityLens/Fixture
    QML_FILES
        Main.qml
)

enable_testing()
add_test(
    NAME qmlqualitylens_qml_tests
    COMMAND Qt6::qmltestrunner
        -input ${CMAKE_CURRENT_SOURCE_DIR}/tests
        -import ${CMAKE_CURRENT_BINARY_DIR}
        -o -,txt
)
set_tests_properties(qmlqualitylens_qml_tests PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen"
)
