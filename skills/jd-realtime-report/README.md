# 京东实时推广费与投产 Skill

合并两种日常工作，一条命令更新实时推广费，另一条命令更新商智和推广费两张投产输入表。完整模式在商智导出时并行查询京准通、打开金山文档，校验后先写推广费和说明，再写商智，最后记录 A1 完成时间。

支持 Windows、Google Chrome 和金山文档网页。商智页面与 WPS 的布局变化可能需要调整定位。京准通接口权限由使用者的应用和店铺授权决定。

- [技能说明](SKILL.md)
- [配置、安装与运行](references/runbook.md)
- [字段与口径](references/schema.md)
- [空白配置模板](settings.example.env)

## 本机使用

将本目录放入 Codex 的技能目录，安装 package.json 与 requirements.txt 中的依赖。凭证文件和本机配置放在仓库外，按运行手册使用 `--env-file` 载入。

```powershell
node --env-file="本机配置文件的绝对路径" scripts/run_realtime_update.cjs --scope all
node --env-file="本机配置文件的绝对路径" scripts/run_realtime_update.cjs --scope promo
```

发布包提供代码和空白配置模板。店铺账号、AppKey、AppSecret、Token、金山文档链接、Chrome 登录状态和业务快照由使用者在本机配置与保管。运行输出默认在用户主目录 `.jd-reports`，Git 忽略规则覆盖本机配置、登录目录和快照文件。
