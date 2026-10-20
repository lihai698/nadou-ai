# 两画布返回和清空协调

目标：迁移普通 returnToCanvasManager/clearCurrentCanvas、智能 backToCanvasList/clearCurrentSmartCanvas 的真实主体，保持界面、保存等待、清空确认、失败回读及草稿重置行为。

- 已核对入口、调用方和现有专项测试；原始快照位于 .git/modularization/navigation-coordinator-before。
- 独立模块 canvas-navigation.js、smart-navigation.js，原入口薄委托；主脚本继续拥有共享状态，host只公开当前所需的实时访问。模块不自己执行初始化或注册监听器。
- AST等价4函数、依赖2模块、专项25/25、JS全量819/819通过。
- 公开代码沙箱两画布编辑后返回列表再重开，正文保存成功；GET和截图证据 output/navigation-coordinator-20261018。清空异常与恢复使用自动化测试，未浏览器手动删除。
- 完整核心Python1099/JS819、预检及diff检查通过；独立复核进行中。

不提交、不发布、不读取私人配置、不调用收费供应商。原有改动全部保留。后续继续远端状态应用等职责，不以本批作为整体完成。
