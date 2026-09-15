cmake_minimum_required(VERSION 3.21)
project(qmlqualitylens_qt_fixture VERSION 1.0 LANGUAGES CXX)

option(LENS_FIXTURE_CONFIGURE_FAILURE "Exercise failed configure evidence" OFF)
option(LENS_FIXTURE_BUILD_FAILURE "Exercise failed build evidence" OFF)
option(LENS_FIXTURE_TEST_FAILURE "Exercise failed CTest evidence" OFF)
if(LENS_FIXTURE_CONFIGURE_FAILURE)
    message(FATAL_ERROR "Intentional fixture configure failure")
endif()

find_package(Qt6 6.4 REQUIRED COMPONENTS Qml Quick QuickTest)
qt_standard_project_setup(REQUIRES 6.4)
if(QT_KNOWN_POLICY_QTP0001)
    qt_policy(SET QTP0001 NEW)
endif()

# A real loadable QML module, shared by the test runner and smoke application.
qt_add_library(qmlqualitylens_fixture SHARED)
target_link_libraries(qmlqualitylens_fixture PRIVATE Qt6::Quick)
qt_add_qml_module(qmlqualitylens_fixture
    URI QmlQualityLens.Fixture
    VERSION 1.0
    OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/QmlQualityLens/Fixture"
    QML_FILES Main.qml
)
# Keep plugin/app locations deterministic for both Ninja and Ninja Multi-Config.
set_target_properties(qmlqualitylens_fixtureplugin PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/QmlQualityLens/Fixture/$<0:>"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/QmlQualityLens/Fixture/$<0:>"
)
qt_add_executable(qmlqualitylens_smoke main.cpp)
target_link_libraries(qmlqualitylens_smoke PRIVATE Qt6::Quick)
target_compile_definitions(qmlqualitylens_smoke PRIVATE
    FIXTURE_QML_IMPORT_PATH="${CMAKE_CURRENT_BINARY_DIR}"
)
set_target_properties(qmlqualitylens_smoke PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin/$<0:>"
)
add_dependencies(qmlqualitylens_smoke qmlqualitylens_fixtureplugin)

if(LENS_FIXTURE_BUILD_FAILURE)
    add_custom_target(intentional_build_failure COMMAND "${CMAKE_COMMAND}" -E false)
    add_dependencies(qmlqualitylens_fixture intentional_build_failure)
endif()

enable_testing()
add_test(NAME qmlqualitylens_qml_tests
    COMMAND Qt6::qmltestrunner -input "${CMAKE_CURRENT_SOURCE_DIR}/tests"
        -import "${CMAKE_CURRENT_BINARY_DIR}" -o -,txt
)
add_test(NAME qmlqualitylens_smoke COMMAND qmlqualitylens_smoke)
set_tests_properties(qmlqualitylens_qml_tests qmlqualitylens_smoke PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software"
    TIMEOUT 30
)
if(LENS_FIXTURE_TEST_FAILURE)
    add_test(NAME intentional_test_failure COMMAND "${CMAKE_COMMAND}" -E false)
endif()

# Consumer-side integration: this config does not invoke CMake or CTest again.
set(QMLQUALITYLENS_MODULE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../cmake" CACHE PATH "Lens CMake module directory")
include("${QMLQUALITYLENS_MODULE_DIR}/QmlQualityLens.cmake")
qmlqualitylens_add_target(NAME qml_quality CONFIG quality.config.json)
