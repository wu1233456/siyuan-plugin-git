import {
    Plugin,
    showMessage,
    confirm,
    Dialog,
    Menu,
    getFrontend,
    adaptHotkey,
    openTab,
    IModel as ITabModel
} from "siyuan";
import "@/index.scss";
import { lsNotebooks, appendBlock, createDailyNote } from "./api";
import { initMardownStyle } from './components/markdown';
// 导入新的组件
import { ExportDialog } from './components/ExportDialog';
import { ExportService } from './components/ExportService';
import { HistoryService, HistoryData } from './components/HistoryService';
import { ARCHIVE_STORAGE_NAME, DOCK_STORAGE_NAME, CONFIG_DATA_NAME, ITEMS_PER_PAGE, MAX_TEXT_LENGTH, DOCK_TYPE, SETTINGS_STORAGE_NAME } from './libs/const';
import { iconsSVG } from './components/icon';
import { QuickInputWindow } from './components/QuickInputWindow';
import { SettingUtils } from "./libs/setting-utils";
import { ShareService } from "./components/ShareService";
import { DocumentService } from "./components/DocumentService";
import { EditorService } from "./components/EditorService";
import { ImageService } from "./components/ImageService";
import { ReminderService } from './components/ReminderService';
import moment from 'moment';
import { FlomoService } from './components/FlomoService';
import { CardView } from './components/CardView';

// 在文件开头添加类型定义
interface IHistoryItem {
    text: string;
    timestamp: number;
    tags?: string[];
    isPinned?: boolean;
}

export const isMobile = () => {
    return getFrontend().endsWith('mobile');
}

export interface IPlugin {
    saveContent(content: string): Promise<void>;
    upload(file: File): Promise<string>;
}

export default class PluginQuickNote extends Plugin implements IPlugin {
    private inputText: string = ''; // 添加 inputText 属性
    private isCreatingNote: boolean = false;
    private tempNoteContent: string = '';
    private tempNoteTags: string[] = [];
    private frontend: string;

    private isDescending: boolean = true; //是否降序
    private element: HTMLElement;  //侧边栏dock元素

    private itemsPerPage: number = 10;
    private currentDisplayCount: number = 10; //当前历史小记显示数量
    private selectedTags: string[] = [];//过滤标签
    private showArchived: boolean = false;//是否显示归档小记
    private isBatchSelect: boolean = false;//是否处于批量选择状态

    private exportDialog: ExportDialog;
    private exportService: ExportService;
    private historyService: HistoryService;
    private settingUtils: SettingUtils;
    private shareService: ShareService;
    private documentService: DocumentService;
    private editorService: EditorService;
    private imageService: ImageService;
    private reminderService: ReminderService;
    private flomoService: FlomoService;

    private isInitDefaultData: boolean = false;

    // 在类定义开始处添加属性
    private historyClickHandler: (e: MouseEvent) => Promise<void>;

    async onload() {
        console.log("onload start");
        this.initDefaultData();
        // 初始化设置
        this.settingUtils = new SettingUtils({
            plugin: this,
            name: SETTINGS_STORAGE_NAME,
            callback: async () => {
                // console.log("callback");
                if (this.element) {
                    this.itemsPerPage = ITEMS_PER_PAGE;
                    // 当设置改变时，重新渲染工具栏和历史记录
                    this.renderDockerToolbar();
                    this.renderDockHistory();
                }
            }
        });

        // 初始化 flomo 存储数据
        this.data["flomo-sync-config"] = await this.loadData("flomo-sync-config") || {
            username: "",
            password: "",
            lastSyncTime: moment().format("YYYY-MM-DD 00:00:00"),
            accessToken: ""
        };

        // 添加插入模式设置
        this.settingUtils.addItem({
            key: "insertMode",
            value: "daily",
            type: "select",
            title: this.i18n.note.insertMode,
            description: this.i18n.note.insertModeDesc,
            options: {
                daily: this.i18n.note.insertModeDaily,
                doc: this.i18n.note.insertModeDoc
            }
        });

        // 添加文档ID设置
        this.settingUtils.addItem({
            key: "targetDocId",
            value: "",
            type: "textinput",
            title: this.i18n.note.targetDocId,
            description: this.i18n.note.targetDocIdDesc
        });
        // 添加设置项
        this.settingUtils.addItem({
            key: "defaultNotebook",
            value: "",
            type: "textinput",
            title: this.i18n.note.defaultNotebook,
            description: this.i18n.note.defaultNotebookDesc
        });

        // this.settingUtils.addItem({
        //     key: "autoCopyToDaily",
        //     value: false,
        //     type: "checkbox",
        //     title: this.i18n.note.autoCopyToDaily,
        //     description: this.i18n.note.autoCopyToDailyDesc
        // });
        this.settingUtils.addItem({
            key: "deleteAfterInsert",
            value: true,
            type: "checkbox",
            title: this.i18n.note.deleteAfterInsert,
            description: this.i18n.note.deleteAfterInsertDesc
        });

        this.settingUtils.addItem({
            key: "insertTemplate",
            value: "-  ${time} ${tags}  ${content} ",
            type: "textarea",
            title: this.i18n.note.insertTemplate,
            description: this.i18n.note.insertTemplateDesc
        });

        this.settingUtils.addItem({
            key: "maxTextLength",
            value: 250,
            type: "number",
            title: this.i18n.note.maxTextLength,
            description: this.i18n.note.maxTextLengthDesc
        });

        // this.settingUtils.addItem({
        //     key: "itemsPerPage",
        //     value: 10,
        //     type: "number",
        //     title: this.i18n.note.itemsPerPage,
        //     description: this.i18n.note.itemsPerPageDesc
        // });

        // 添加移动端浮动按钮显示设置
        if (isMobile()) {
            this.settingUtils.addItem({
                key: "showMobileFloatingButton",
                value: true,
                type: "checkbox",
                title: this.i18n.note.showMobileFloatingButton,
                description: this.i18n.note.showMobileFloatingButtonDesc,
                action: {
                    callback: () => {
                        const showButton = this.settingUtils.get("showMobileFloatingButton");
                        const floatingButton = document.querySelector('.mobile-quick-note-btn');
                        if (floatingButton) {
                            floatingButton.style.display = showButton ? 'block' : 'none';
                        }
                    }
                }
            });
        }

        // // 添加自动同步设置
        // this.settingUtils.addItem({
        //     key: "flomoAutoSync",
        //     value: false,
        //     type: "checkbox",
        //     title: this.i18n.note.flomoAutoSync,
        //     description: this.i18n.note.flomoAutoSyncDesc
        // });

        // this.settingUtils.addItem({
        //     key: "flomoSyncInterval",
        //     value: 60,
        //     type: "number",
        //     title: this.i18n.note.flomoSyncInterval,
        //     description: this.i18n.note.flomoSyncIntervalDesc
        // });
        if (!isMobile()) {
            this.settingUtils.addItem({
                key: "quickWindowWidth",
                value: 250,
                type: "number",
                title: this.i18n.note.quickWindowWidth,
                description: this.i18n.note.quickWindowWidthDesc
            });
    
            this.settingUtils.addItem({
                key: "quickWindowHeight",
                value: 300,
                type: "number",
                title: this.i18n.note.quickWindowHeight,
                description: this.i18n.note.quickWindowHeightDesc
            });

            // 添加flomo同步配置
            this.settingUtils.addItem({
                key: "flomoEnabled",
                value: false,
                type: "checkbox",
                title: this.i18n.note.flomoEnabled,
                description: this.i18n.note.flomoEnabledDesc
            });

            // 添加flomo同步配置
            this.settingUtils.addItem({
                key: "flomoUsername",
                value: "",
                type: "textinput",
                title: this.i18n.note.flomoUsername,
                description: this.i18n.note.flomoUsernameDesc
            });

            this.settingUtils.addItem({
                key: "flomoPassword",
                value: "",
                type: "textinput",
                title: this.i18n.note.flomoPassword,
                description: this.i18n.note.flomoPasswordDesc
            });

            this.settingUtils.addItem({
                key: "flomoLastSyncTime",
                value: moment().format("YYYY-MM-DD 00:00:00"),
                type: "textinput",
                title: this.i18n.note.flomoLastSyncTime,
                description: this.i18n.note.flomoLastSyncTimeDesc
            });

            this.settingUtils.addItem({
                key: "flomoAccessToken",
                value: "",
                type: "textinput",
                title: this.i18n.note.flomoAccessToken,
                description: this.i18n.note.flomoAccessTokenDesc
            });

        }

        await this.settingUtils.load();
        this.loadNoteData();
        console.log("onload end");

        // 添加新的卡片视图按钮到顶部工具栏
        this.addTopBar({
            icon: "iconLayout",
            title: this.i18n.note.cardView,
            position: "right",
            callback: () => {
                this.openCardView();
            }
        });
    }

    async onLayoutReady() {
        console.log("onLayoutReady start");
        this.initDefaultData();
        this.initComponents();
        if (isMobile()) {
            console.log("isMobile");
            this.addMobileFloatingButton();
        }
        console.log("onLayoutReady end");
    }

    async onunload() {
        console.log("onunload start");
        this.cleanupEventListeners();
        if (this.reminderService) {
            this.reminderService.destroy();
        }
        if (this.flomoService) {
            this.flomoService.stopAutoSync();
        }
        console.log(this.i18n.byePlugin);
        console.log("onunload end");
    }

    // 添加设置变化的监听
    async onSettingChanged() {
        //关闭自动同步功能，适配移动端后，感觉这里就没有必要了
        // if (this.flomoService) {
        //     this.flomoService.handleSettingChanged();
        // }
    }

    uninstall() {
        console.log("uninstall");
    }

    private async loadNoteData() {
        // 初始化未归档小记数据
        let unarchive_history = await this.loadData(DOCK_STORAGE_NAME) || {
            history: []
        };

        // 初始化归档数据
        let archive_history = await this.loadData(ARCHIVE_STORAGE_NAME) || {
            history: []
        };

        // 获取设置的每页显示数量，如果没有设置则使用默认值
        this.itemsPerPage =  ITEMS_PER_PAGE;
        this.currentDisplayCount = this.itemsPerPage;

        // 初始化历史服务
        const historyData: HistoryData = {
            history: unarchive_history.history || [],
            archivedHistory: archive_history.history || []
        };

        this.historyService = new HistoryService(this, historyData, this.itemsPerPage, this.i18n);

        // 初始化编辑器服务
        this.editorService = new EditorService(this.i18n);

        // 初始化图片服务
        this.imageService = new ImageService(this.i18n);

        // 初始化文档服务
        this.documentService = new DocumentService(
            this.i18n,
            this.settingUtils,
            () => {
                this.onSettingChanged();
                this.renderDockHistory();
            },
            this,
            this.historyService
        );
        if (!isMobile()) {
            // 初始化提醒服务
            this.reminderService = await ReminderService.create(this.i18n, this);
            // 初始化flomo服务
            this.flomoService = new FlomoService(this, this.historyService, this.i18n);
            // 添加提醒完成事件监听
            window.addEventListener('reminder-completed', ((event: CustomEvent) => {
                const { timestamp, snoozeCount } = event.detail;
                if (snoozeCount === 0) {
                    // 如果没有设置延迟提醒,更新历史记录显示
                    this.renderDockHistory();
                }
            }) as EventListener);
        }
        //初始化分享服务
        this.shareService = new ShareService(this, this.historyService);

        if (this.element) {
            this.initDockPanel();
        }
    }
    //设置默认值
    private async initDefaultData() {
        console.log("initDefaultData start");
        if (this.isInitDefaultData) {
            return;
        }
        this.isInitDefaultData = true;
        this.frontend = getFrontend();

        // 初始化配置数据
        this.data[CONFIG_DATA_NAME] = {
            editorVisible: true,
        }

        const historyData: HistoryData = {
            history: [],
            archivedHistory: []
        };

        this.historyService = new HistoryService(this, historyData, this.itemsPerPage, this.i18n);

        // 初始化编辑器服务
        this.editorService = new EditorService(this.i18n);

        // 初始化图片服务
        this.imageService = new ImageService(this.i18n);

        // 初始化文档服务
        this.documentService = new DocumentService(
            this.i18n,
            this.settingUtils,
            () => {
                this.renderDockHistory();
            },
            this,
            this.historyService
        );

        this.shareService = new ShareService(this, this.historyService);

        // 初始化提醒服务
        if (!isMobile()) {
            this.reminderService = await ReminderService.create(this.i18n, this);
        }
        console.log("initDefaultData end");

    }
    private initComponents() {
        console.log("initComponents start");
        this.addIcons(iconsSVG);
        this.initDock();
        initMardownStyle();
        if (!isMobile()) {
            // 添加顶部栏按钮
            this.addTopBar({
                icon: "iconSmallNote",
                title: this.i18n.note.title,
                position: "right",
                callback: () => {
                    this.createNewNote();
                }
            });
            // 添加快捷键命令
            this.addCommand({
                langKey: this.i18n.note.createNewSmallNote,
                hotkey: "⇧⌘Y",
                globalCallback: () => {
                    if (this.frontend === 'browser-desktop' || this.frontend === 'browser-mobile') {
                        this.createNewNote();
                    } else {
                        this.createQuickInputWindow();
                    }
                }
            });
        }
    }

    private addMobileFloatingButton() {
        // 检查是否已存在按钮，避免重复添加
        const existingButton = document.querySelector('.mobile-quick-note-btn');
        if (existingButton) {
            console.log("existingButton");
            return;
        }

        // 创建浮动按钮
        const floatingButton = document.createElement('div');
        floatingButton.className = 'mobile-quick-note-btn collapsed';
        
        // 根据设置决定是否显示浮动按钮
        const showButton = this.settingUtils.get("showMobileFloatingButton");
        floatingButton.style.display = showButton ? 'block' : 'none';

        floatingButton.innerHTML = `
            <div class="button-content">
                <svg class="b3-button__icon">
                    <use xlink:href="#iconSmallNote"></use>
                </svg>
                <span class="button-label">小记</span>
            </div>
        `;

        // 添加点击事件处理
        floatingButton.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            if (floatingButton.classList.contains('collapsed')) {
                floatingButton.classList.remove('collapsed');
                floatingButton.classList.add('expanded');
            } else {
                this.createMobileQuickNote();
            }
        });

        // 添加触摸事件处理，防止滑动时触发点击
        let touchStartX = 0;
        let touchStartY = 0;
        floatingButton.addEventListener('touchstart', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        });

        floatingButton.addEventListener('touchend', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const deltaX = Math.abs(touchEndX - touchStartX);
            const deltaY = Math.abs(touchEndY - touchStartY);
            
            // 如果移动距离小于10px，认为是点击而不是滑动
            if (deltaX < 10 && deltaY < 10) {
                if (floatingButton.classList.contains('collapsed')) {
                    floatingButton.classList.remove('collapsed');
                    floatingButton.classList.add('expanded');
                } else {
                    this.createMobileQuickNote();
                }
            }
        });

        // 添加点击外部区域收起按钮的处理
        const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
            if (!floatingButton.contains(e.target as Node) && floatingButton.classList.contains('expanded')) {
                floatingButton.classList.remove('expanded');
                floatingButton.classList.add('collapsed');
            }
        };

        // 添加全局点击和触摸事件监听
        document.addEventListener('click', handleOutsideClick);
        document.addEventListener('touchend', handleOutsideClick);

        // 在组件卸载时移除事件监听
        this.addCommand({
            langKey: '',
            hotkey: '',
            callback: () => {
                document.removeEventListener('click', handleOutsideClick);
                document.removeEventListener('touchend', handleOutsideClick);
            }
        });

        // 添加到body
        document.body.appendChild(floatingButton);

        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .mobile-quick-note-btn {
                position: fixed;
                right: 0;
                top: 70%;
                transform: translateY(-50%);
                z-index: 5;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                cursor: pointer;
                background-color: var(--b3-theme-surface);
                color: var(--b3-theme-on-surface);
                box-shadow: var(--b3-dialog-shadow);
                backdrop-filter: blur(8px);
                border: 1px solid var(--b3-theme-surface-lighter);
                border-radius: 12px 0 0 12px;
                padding: 8px 16px 8px 4px;
            }

            .mobile-quick-note-btn.collapsed {
                opacity: 0.6;
                transform: translateY(-50%) translateX(60%);
            }

            .mobile-quick-note-btn.expanded {
                opacity: 1;
                transform: translateY(-50%) translateX(0);
            }

            .mobile-quick-note-btn .button-content {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .mobile-quick-note-btn .b3-button__icon {
                height: 20px;
                width: 20px;
                color: var(--b3-theme-primary);
            }

            .mobile-quick-note-btn .button-label {
                font-size: 14px;
                font-weight: 500;
                letter-spacing: 0.3px;
                color: var(--b3-theme-on-surface);
                white-space: nowrap;
            }
        `;
        document.head.appendChild(style);
    }
    private initDock() {
        console.log("initDock start");
        // 创建 dock 时读取保存的位置
        this.addDock({
            config: {
                position: "RightTop",
                size: { width: 300, height: 0 },
                icon: "iconSmallNote",
                hotkey: '⇧⌘U',
                title: this.i18n.note.showQuickNoteSidebar,
            },
            data: {
                plugin: this
            },
            type: DOCK_TYPE,
            init() {
                this.data.plugin.element = this.element;
                this.data.plugin.initDockPanel();
            },
            destroy() {
                console.log("destroy dock:", DOCK_TYPE);
            }
        });
        console.log("initDock end");
    }


    private initDockPanel() {
        console.log("initDockPanel");
        let element = this.element;

        element.innerHTML = `<div id="quick_notes_dock_container" class="fn__flex-1 fn__flex-column" style="height: 100%;">
                                <div class="fn__flex-1 plugin-sample__custom-dock fn__flex-column dock_quicknotes_container" style="align-items: center;"> 
                                    <div class="topbar-container" style="width:100%"></div>
                                    <div class="editor-container" style="${this.data[CONFIG_DATA_NAME].editorVisible ? 'width: 95%;display:block' : 'width: 95%;display:None'}" ></div>
                                    <div class="toolbar-container" style="border-bottom: 1px solid var(--b3-border-color); flex-shrink: 0; width: 95%;"></div>
                                    <div class="fn__flex-1 history-list" style="overflow: auto; ;width: 95%;">
                                    </div>
                                    ${isMobile() ? `
                                    <div class="mobile-add-button" style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 999;">
                                        <button class="b3-button" style="border: none; border-radius: 50%; width: 52px; height: 52px; padding: 0; display: flex; align-items: center; justify-content: center; background: var(--b3-theme-primary); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15); transition: all 0.2s ease;">
                                            <svg class="b3-button__icon" style="height: 24px; width: 24px; color: var(--b3-theme-on-primary);">
                                                <use xlink:href="#iconAdd"></use>
                                            </svg>
                                        </button>
                                    </div>
                                    ` : ''}
                                </div>
                            </div>`;
        if(!isMobile()){
            this.renderDockerTopbar();
            this.renderDockerEditor();
        } else {
            // 为移动端添加按钮添加点击事件
            const addButton = element.querySelector('.mobile-add-button button');
            if (addButton) {
                addButton.addEventListener('click', () => {
                    this.createMobileQuickNote();
                });
            }
        }
        this.renderDockHistory();
        this.renderDockerToolbar();
        this.bindDockPanelEvents();
    }

    private renderDockerTopbar() {
        this.element.querySelector('.topbar-container').innerHTML = ` <div class="block__icons">
        <div class="block__logo">
            <svg class="block__logoicon">
                <use xlink:href="#iconSmallNote"></use>
            </svg>
            ${this.i18n.note.title}
        </div>
        <span class="fn__flex-1 fn__space"></span>
        <span data-type="toggle-editor" class="block__icon b3-tooltips b3-tooltips__sw editor_toggle_btn"
            aria-label="${this.data[CONFIG_DATA_NAME].editorVisible ? this.i18n.note.hideEditor : this.i18n.note.showEditor}">
            <svg class="block__logoicon">
                <use xlink:href="${this.data[CONFIG_DATA_NAME].editorVisible ? '#iconPreview' : '#iconEdit'}"></use>
            </svg>
        </span>
        <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw refresh_btn" aria-label="Refresh">
            <svg class="block__logoicon">
                <use xlink:href="#iconRefresh"></use>
            </svg>
        </span>
        <span data-type="export" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="Export">
            <svg class="block__logoicon">
                <use xlink:href="#iconExportNew"></use>
            </svg>
        </span>
        <span data-type="min" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="Min ${adaptHotkey("⌘W")}">
            <svg class="block__logoicon">
                <use xlink:href="#iconMin"></use>
            </svg>
        </span>
             </div>`;
        this.renderDockTopbarEvents();

    }

    private renderDockTopbarEvents() {
        let element = this.element;
        const editorToggleBtn = element.querySelector('.editor_toggle_btn');
        editorToggleBtn.addEventListener('click', async () => {
            const editorContainer = element.querySelector('.editor-container');
            if (editorContainer) {
                const isVisible = editorContainer.style.display !== 'none';
                editorContainer.style.display = isVisible ? 'none' : 'block';
                // 保存状态
                this.data[CONFIG_DATA_NAME].editorVisible = !isVisible;
                await this.saveData(CONFIG_DATA_NAME, this.data[CONFIG_DATA_NAME]);
                // 更新按钮图标和提示文本
                const icon = editorToggleBtn.querySelector('use');
                if (icon) {
                    icon.setAttribute('xlink:href', !isVisible ? '#iconPreview' : '#iconEdit');
                }
                editorToggleBtn.setAttribute('aria-label', !isVisible ? this.i18n.note.hideEditor : this.i18n.note.showEditor);
            }
        });

        const refreshBtn = element.querySelector('.refresh_btn');
        refreshBtn.addEventListener('click', async () => {
            this.currentDisplayCount = this.itemsPerPage;
            this.loadNoteData();
        });
    }
    private renderDockerEditor() {
        let element = this.element;

        element.querySelector('.editor-container').innerHTML = this.editorService.getEditorTemplate({
            text: this.tempNoteContent,
            i18n: this.i18n
        });
        // 绑定事件监听器
        const textarea = element.querySelector('textarea');
        if (textarea) {
            // 添加快捷键保存功能和待办转换功能
            textarea.addEventListener('keydown', async (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (textarea.value.trim()) {
                        const tags = Array.from(element.querySelectorAll('.tag-item'))
                            .map(tag => tag.getAttribute('data-tag'));
                        await this.saveContent(textarea.value, tags);
                        textarea.value = '';
                        this.inputText = '';
                        // 清空标签
                        element.querySelector('.tags-list').innerHTML = '';
                    }
                }
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                    e.preventDefault();
                    const addTagBtn = element.querySelector('.add-tag-btn') as HTMLElement;
                    if (addTagBtn) {
                        addTagBtn.click();
                    }
                }
            });

            // 实时保存输入内容
            textarea.oninput = (e) => {
                this.inputText = (e.target as HTMLTextAreaElement).value;
            };
        }
        // 修改标签输入相关的 HTML 和事件处理
        this.setupTagsFeature(element);

        element.querySelector('.main_save_btn').addEventListener('click', async () => {
            if (textarea.value.trim()) {
                const tags = Array.from(element.querySelectorAll('.tag-item'))
                    .map(tag => tag.getAttribute('data-tag'));
                await this.saveContent(textarea.value, tags);
            }
        });
    }

    private renderDockerToolbar() {
        if (isMobile()) {
            this.element.querySelector('.toolbar-container').innerHTML =
                `
                                <div class="fn__flex fn__flex-center" style="padding: 8px;">
                                    <div style="color: var(--b3-theme-on-surface-light); font-size: 12px;">
                                        ${this.i18n.note.total.replace('${count}', (this.historyService.getCurrentData() ||
                    []).length.toString())}
                                    </div>
                                    <span class="fn__flex-1"></span>
                                    <button class="filter-menu-btn" style="border: none; background: none; padding: 4px; cursor: pointer;">
                                        <svg class="b3-button__icon" style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                                            <use xlink:href="#iconFilter"></use>
                                        </svg>
                                    </button>
                                </div>
                                <div class="fn__flex fn__flex-end" style="padding: 0 8px 8px 8px; gap: 8px;">
                                    <!-- 批量操作工具栏，默认隐藏 -->
                                    <div class="batch-toolbar fn__none fn__flex-column" style="gap: 8px; margin-right: auto;">
                                        <div class="fn__flex" style="gap: 8px;">
                                            <button class="b3-button b3-button--text batch-copy-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;" aria-label="${this.i18n.note.copy}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconCopy"></use>
                                                </svg>
                                            </button>
                                            <button class="b3-button b3-button--text batch-tag-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;" aria-label="${this.i18n.note.tag}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconTags"></use>
                                                </svg>
                                            </button>
                                            <button class="b3-button b3-button--text batch-archive-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;"
                                                aria-label="${this.showArchived ? this.i18n.note.unarchive : this.i18n.note.archive}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconArchive"></use>
                                                </svg>
                                            </button>
                                            <button class="b3-button b3-button--text batch-delete-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;" aria-label="${this.i18n.note.delete}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconTrashcan"></use>
                                                </svg>
                                            </button>
                                            <button class="b3-button b3-button--text batch-merge-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;" aria-label="${this.i18n.note.merge}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconMerge"></use>
                                                </svg>
                                            </button>
                                        </div>
                                        <div class="fn__flex" style="gap: 8px;">
                                            <button class="b3-button b3-button--outline select-all-btn"
                                                style="padding: 4px 8px; font-size: 12px;">
                                                ${this.i18n.note.selectAll}
                                            </button>
                                            <button class="b3-button b3-button--cancel cancel-select-btn"
                                                style="padding: 4px 8px; font-size: 12px;">
                                                ${this.i18n.note.cancelSelect}
                                            </button>
                                        </div>
                                    </div>
                                    <!-- 常规工具栏 -->
                                    <div class="normal-toolbar fn__flex" style="gap: 8px;">
                                        <div class="search-container fn__flex">
                                            <div class="search-wrapper" style="position: relative;">
                                                <input type="text" class="search-input b3-text-field" placeholder="${this.i18n.note.search}"
                                                    style="width: 0; padding: 4px 8px; transition: all 0.3s ease; opacity: 0;">
                                                <button class="search-btn"
                                                    style="position: absolute; right: 0; top: 0; border: none; background: none; padding: 4px; cursor: pointer;">
                                                    <svg class="b3-button__icon"
                                                        style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                                                        <use xlink:href="#iconSearch"></use>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                        <button class="filter-btn"
                                            style="border: none; background: none; padding: 4px; cursor: pointer; position: relative;"
                                            title="${this.i18n.note.tagFilter}">
                                            <svg class="b3-button__icon" style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                                                <use xlink:href="#iconTags"></use>
                                            </svg>
                                            ${this.selectedTags.length > 0 ? `
                                            <div
                                                style="position: absolute; top: 0; right: 0; width: 6px; height: 6px; border-radius: 50%; background-color: var(--b3-theme-primary);">
                                            </div>
                                            ` : ''}
                                        </button>
                                        <button class="sort-btn" style="border: none; background: none; padding: 4px; cursor: pointer;"
                                            title="${this.i18n.note.sort}">
                                            <svg class="b3-button__icon" style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                                                <use xlink:href="#iconSort"></use>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div class="filter-panel"
                                    style="display: none; padding: 8px; border-top: 1px solid var(--b3-border-color);">
                                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 8px;">
                                        ${this.i18n.note.tagFilter}
                                    </div>
                                    <div class="filter-tags" style="display: flex; flex-wrap: wrap; gap: 8px;">
                                        ${Array.from(new Set(this.historyService.getCurrentData()?.flatMap(item => item.tags || []) || []))
                    .map(tag => {
                        const isSelected = this.selectedTags.includes(tag);
                        return `
                                        <span class="b3-chip b3-chip--middle filter-tag b3-tooltips b3-tooltips__n" style="cursor: pointer; 
                                                                                background-color: ${isSelected ? 'var(--b3-theme-primary)' : 'var(--b3-theme-surface)'};
                                                                                color: ${isSelected ? 'var(--b3-theme-on-primary)' : 'var(--b3-theme-on-surface)'};
                                                                                border: 1px solid ${isSelected ? 'var(--b3-theme-primary)' : 'var(--b3-border-color)'};
                                                                                transition: all 0.2s ease;" data-tag="${tag}"
                                            aria-label="${tag}" data-selected="${isSelected}">
                                            <span class="b3-chip__content"
                                                style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tag}</span>
                                            <span class="tag-count" style="margin-left: 4px; font-size: 10px; opacity: 0.7;">
                                                ${this.historyService.getCurrentData().filter(item => item.tags?.includes(tag)).length}
                                            </span>
                                        </span>`;
                    }).join('')}
                                    </div>
                                </div>`;
        } else {
            this.element.querySelector('.toolbar-container').innerHTML =
                `
                                <div class="fn__flex fn__flex-center" style="padding: 8px;">
                                    <div style="color: var(--b3-theme-on-surface-light); font-size: 12px;">
                                        ${this.i18n.note.total.replace('${count}', (this.historyService.getCurrentData() ||
                    []).length.toString())}
                                    </div>
                                    <span class="fn__flex-1"></span>
                                    ${(() => {
                    const isFlomoEnabled = this.settingUtils.get("flomoEnabled");
                    return `<button class="b3-tooltips b3-tooltips__n" style="border: none; background: none; padding: 4px; cursor: ${isFlomoEnabled ? 'pointer' : 'not-allowed'};" aria-label="${this.i18n.note.syncNote}">
                                            <svg style="height: 16px; width: 16px; color: ${isFlomoEnabled ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface-light)'};" class="sync_note_btn b3-button__icon" >
                                                <use xlink:href="#icon${isFlomoEnabled ? 'Cloud' : 'CloudOff'}"></use>
                                            </svg>
                                        </button>`;
                })()}
                                    <button class="filter-menu-btn" style="border: none; background: none; padding: 4px; cursor: pointer;">
                                        <svg class="b3-button__icon" style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                                            <use xlink:href="#iconFilter"></use>
                                        </svg>
                                    </button>
                                </div>
                                <div class="fn__flex fn__flex-end" style="padding: 0 8px 8px 8px; gap: 8px;">
                                    <!-- 批量操作工具栏，默认隐藏 -->
                                    <div class="batch-toolbar fn__none fn__flex-column" style="gap: 8px; margin-right: auto;">
                                        <div class="fn__flex" style="gap: 8px;">
                                            <button class="b3-button b3-button--text batch-copy-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;" aria-label="${this.i18n.note.copy}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconCopy"></use>
                                                </svg>
                                            </button>
                                            <button class="b3-button b3-button--text batch-tag-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;" aria-label="${this.i18n.note.tag}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconTags"></use>
                                                </svg>
                                            </button>
                                            <button class="b3-button b3-button--text batch-archive-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;"
                                                aria-label="${this.showArchived ? this.i18n.note.unarchive : this.i18n.note.archive}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconArchive"></use>
                                                </svg>
                                            </button>
                                            <button class="b3-button b3-button--text batch-delete-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;" aria-label="${this.i18n.note.delete}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconTrashcan"></use>
                                                </svg>
                                            </button>
                                            <button class="b3-button b3-button--text batch-merge-btn b3-tooltips b3-tooltips__n"
                                                style="padding: 2px 2px; font-size: 12px;" aria-label="${this.i18n.note.merge}">
                                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                                    <use xlink:href="#iconMerge"></use>
                                                </svg>
                                            </button>
                                        </div>
                                        <div class="fn__flex" style="gap: 8px;">
                                            <button class="b3-button b3-button--outline select-all-btn"
                                                style="padding: 4px 8px; font-size: 12px;">
                                                ${this.i18n.note.selectAll}
                                            </button>
                                            <button class="b3-button b3-button--cancel cancel-select-btn"
                                                style="padding: 4px 8px; font-size: 12px;">
                                                ${this.i18n.note.cancelSelect}
                                            </button>
                                        </div>
                                    </div>
                                    <!-- 常规工具栏 -->
                                    <div class="normal-toolbar fn__flex" style="gap: 8px;">
                                        <div class="search-container fn__flex">
                                            <div class="search-wrapper" style="position: relative;">
                                                <input type="text" class="search-input b3-text-field" placeholder="${this.i18n.note.search}"
                                                    style="width: 0; padding: 4px 8px; transition: all 0.3s ease; opacity: 0;">
                                                <button class="search-btn"
                                                    style="position: absolute; right: 0; top: 0; border: none; background: none; padding: 4px; cursor: pointer;">
                                                    <svg class="b3-button__icon"
                                                        style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                                                        <use xlink:href="#iconSearch"></use>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                        <button class="filter-btn"
                                            style="border: none; background: none; padding: 4px; cursor: pointer; position: relative;"
                                            title="${this.i18n.note.tagFilter}">
                                            <svg class="b3-button__icon" style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                                                <use xlink:href="#iconTags"></use>
                                            </svg>
                                            ${this.selectedTags.length > 0 ? `
                                            <div
                                                style="position: absolute; top: 0; right: 0; width: 6px; height: 6px; border-radius: 50%; background-color: var(--b3-theme-primary);">
                                            </div>
                                            ` : ''}
                                        </button>
                                        <button class="sort-btn" style="border: none; background: none; padding: 4px; cursor: pointer;"
                                            title="${this.i18n.note.sort}">
                                            <svg class="b3-button__icon" style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                                                <use xlink:href="#iconSort"></use>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div class="filter-panel"
                                    style="display: none; padding: 8px; border-top: 1px solid var(--b3-border-color);">
                                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 8px;">
                                        ${this.i18n.note.tagFilter}
                                    </div>
                                    <div class="filter-tags" style="display: flex; flex-wrap: wrap; gap: 8px;">
                                        ${Array.from(new Set(this.historyService.getCurrentData()?.flatMap(item => item.tags || []) || []))
                    .map(tag => {
                        const isSelected = this.selectedTags.includes(tag);
                        return `
                                        <span class="b3-chip b3-chip--middle filter-tag b3-tooltips b3-tooltips__n" style="cursor: pointer; 
                                                                                background-color: ${isSelected ? 'var(--b3-theme-primary)' : 'var(--b3-theme-surface)'};
                                                                                color: ${isSelected ? 'var(--b3-theme-on-primary)' : 'var(--b3-theme-on-surface)'};
                                                                                border: 1px solid ${isSelected ? 'var(--b3-theme-primary)' : 'var(--b3-border-color)'};
                                                                                transition: all 0.2s ease;" data-tag="${tag}"
                                            aria-label="${tag}" data-selected="${isSelected}">
                                            <span class="b3-chip__content"
                                                style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tag}</span>
                                            <span class="tag-count" style="margin-left: 4px; font-size: 10px; opacity: 0.7;">
                                                ${this.historyService.getCurrentData().filter(item => item.tags?.includes(tag)).length}
                                            </span>
                                        </span>`;
                    }).join('')}
                                    </div>
                                </div>`;
        }
        this.bindDockerToolbarEvents();
    }
    private bindDockerToolbarEvents() {
        let element = this.element;

        // 添加批量选择相关的事件处理
        const container = element.querySelector('.toolbar-container');
        const filterMenuBtn = container.querySelector('.filter-menu-btn');
        const batchToolbar = container.querySelector('.batch-toolbar') as HTMLElement;
        const normalToolbar = container.querySelector('.normal-toolbar') as HTMLElement;

        if (!(isMobile())) {
            // 添加同步按钮事件
            const syncBtn = element.querySelector('.sync_note_btn');
            syncBtn.addEventListener('click', async () => {
                const isFlomoEnabled = this.settingUtils.get("flomoEnabled");
                if (!isFlomoEnabled) {
                    showMessage(this.i18n.note.flomoSync.needEnable);
                    return;
                }

                const icon = syncBtn.querySelector('use');
                // 添加旋转动画样式
                syncBtn.style.animation = 'rotate 1s linear infinite';
                icon.setAttribute('xlink:href', '#iconRefresh');

                try {
                    await this.flomoService.sync();
                } finally {
                    // 停止旋转动画并恢复图标
                    syncBtn.style.animation = '';
                    icon.setAttribute('xlink:href', isFlomoEnabled ? '#iconCloud' : '#iconCloudOff');
                }
            });
        }

        filterMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = filterMenuBtn.getBoundingClientRect();
            const menu = new Menu("filterMenu");

            // 添加批量选择选项
            menu.addItem({
                icon: "iconCheck",
                label: this.i18n.note.batchSelect,
                click: () => {
                    this.isBatchSelect = true;
                    // 重置全选按钮文本
                    if (selectAllBtn) {
                        selectAllBtn.textContent = this.i18n.note.selectAll;
                    }
                    batchToolbar.classList.remove('fn__none');
                    normalToolbar.classList.add('fn__none');
                    this.renderDockHistory();
                }
            });

            menu.addSeparator();

            // 修改为状态过滤选项
            menu.addItem({
                icon: "iconStatus",
                label: this.i18n.note.status,
                type: "submenu",
                submenu: [{
                    icon: !this.showArchived ? "iconSelect" : "",
                    label: this.i18n.note.showActive,
                    click: () => {
                        this.showArchived = false;
                        this.historyService.setShowArchived(false);
                        this.renderDockerToolbar();
                        this.renderDockHistory();
                    }
                }, {
                    icon: this.showArchived ? "iconSelect" : "",
                    label: this.i18n.note.showArchived,
                    click: () => {
                        this.showArchived = true;
                        this.historyService.setShowArchived(true);
                        // console.log("this.showArchived",this.showArchived);
                        this.renderDockerToolbar();
                        this.renderDockHistory();
                    }
                }]
            });

            // 添加其他过滤选项
            menu.addItem({
                icon: "iconSort",
                label: this.i18n.note.sort,
                type: "submenu",
                submenu: [{
                    icon: this.isDescending ? "iconSelect" : "",
                    label: this.i18n.note.sortByTimeDesc,
                    click: () => {
                        this.isDescending = true;
                        this.historyService.setIsDescending(true);
                        // renderDock(true);
                        this.renderDockHistory();
                    }
                }, {
                    icon: !this.isDescending ? "iconSelect" : "",
                    label: this.i18n.note.sortByTimeAsc,
                    click: () => {
                        this.isDescending = false;
                        this.historyService.setIsDescending(false);
                        this.renderDockHistory();
                    }
                }]
            });

            menu.open({
                x: rect.right,
                y: rect.bottom,
                isLeft: true,
            });
        });

        // 批量选择相关的事件处理保持不变
        const selectAllBtn = container.querySelector('.select-all-btn') as HTMLButtonElement;
        const batchDeleteBtn = container.querySelector('.batch-delete-btn') as HTMLButtonElement;
        const cancelSelectBtn = container.querySelector('.cancel-select-btn') as HTMLButtonElement;

        if (selectAllBtn && batchDeleteBtn && cancelSelectBtn) {
            // 取消选择
            cancelSelectBtn.onclick = () => {
                batchToolbar.classList.add('fn__none');
                normalToolbar.classList.remove('fn__none');
                this.isBatchSelect = false;
                this.renderDockHistory();
            };

            // 全选/取消全选
            selectAllBtn.onclick = () => {
                let historyList = element.querySelector('.history-list');
                const inputs = historyList.querySelectorAll('.batch-checkbox input') as NodeListOf<HTMLInputElement>;
                const allChecked = Array.from(inputs).every(input => input.checked);
                inputs.forEach(input => input.checked = !allChecked);
                selectAllBtn.textContent = allChecked ? this.i18n.note.selectAll : this.i18n.note.deselectAll;
            };

            // 批量删除
            batchDeleteBtn.onclick = async () => {
                let historyList = element.querySelector('.history-list');
                const selectedTimestamps = Array.from(historyList.querySelectorAll('.batch-checkbox input:checked'))
                    .map(input => Number((input as HTMLInputElement).getAttribute('data-timestamp')));

                if (selectedTimestamps.length === 0) {
                    showMessage(this.i18n.note.noItemSelected);
                    return;
                }

                confirm(this.i18n.note.batchDelete, this.i18n.note.batchDeleteConfirm, async () => {
                    try {
                        this.historyService.batchDeleteItems(selectedTimestamps)
                        cancelSelectBtn.click();
                        this.renderDockerToolbar();
                        this.renderDockHistory();
                        // showMessage(this.i18n.note.batchDeleteSuccess);
                    } catch (error) {
                        showMessage(this.i18n.note.batchDeleteFailed);
                    }
                });
            };
        }

        // 批量复制
        const batchCopyBtn = container.querySelector('.batch-copy-btn') as HTMLButtonElement;

        batchCopyBtn.onclick = async () => {
            let historyList = element.querySelector('.history-list');
            const selectedItems = Array.from(historyList.querySelectorAll('.batch-checkbox input:checked'))
                .map(input => {
                    const historyItem = (input as HTMLInputElement).closest('.history-item');
                    return historyItem?.querySelector('[data-text]')?.getAttribute('data-text') || '';
                })
                .filter(text => text);

            if (selectedItems.length === 0) {
                showMessage(this.i18n.note.noItemSelected);
                return;
            }

            try {
                await navigator.clipboard.writeText(selectedItems.join('\n\n'));
                showMessage(this.i18n.note.copySuccess);
                cancelSelectBtn.click(); // 复制后自动退出选择模式
            } catch (err) {
                console.error('批量复制失败:', err);
                showMessage(this.i18n.note.copyFailed);
            }
        };

        // 批量归档/取消归档
        const batchArchiveBtn = container.querySelector('.batch-archive-btn') as HTMLButtonElement;
        if (batchArchiveBtn) {
            batchArchiveBtn.onclick = async () => {
                let historyList = element.querySelector('.history-list');
                const selectedItems = Array.from(historyList.querySelectorAll('.batch-checkbox input:checked'))
                const selectedTimestamps = Array.from(selectedItems)
                    .map(input => Number((input as HTMLInputElement).getAttribute('data-timestamp')));

                if (selectedTimestamps.length === 0) {
                    showMessage(this.i18n.note.noItemSelected);
                    return;
                }

                const confirmMessage = this.showArchived ?
                    this.i18n.note.batchUnarchiveConfirm :
                    this.i18n.note.batchArchiveConfirm;

                confirm(
                    this.showArchived ? this.i18n.note.unarchive : this.i18n.note.archive,
                    confirmMessage,
                    async () => {
                        try {
                            if (this.showArchived) {
                                this.historyService.batchUnarchiveItems(selectedTimestamps);
                            } else {
                                this.historyService.batchArchiveItems(selectedTimestamps);
                            }


                            showMessage(this.showArchived ?
                                this.i18n.note.batchUnarchiveSuccess :
                                this.i18n.note.batchArchiveSuccess
                            );

                            // cancelSelectBtn.click(); // 操作完成后退出选择模式
                            this.renderDockerToolbar();
                            this.renderDockHistory();
                        } catch (error) {
                            console.error('批量归档/取消归档失败:', error);
                            showMessage(this.showArchived ?
                                this.i18n.note.batchUnarchiveFailed :
                                this.i18n.note.batchArchiveFailed
                            );
                        }
                    }
                );
            };
        }

        // 批量合并功能
        const batchMergeBtn = container.querySelector('.batch-merge-btn') as HTMLButtonElement;
        if (batchMergeBtn) {
            batchMergeBtn.onclick = async () => {
                let historyList = element.querySelector('.history-list');
                const selectedItems = Array.from(historyList.querySelectorAll('.batch-checkbox input:checked'))
                    .map(input => {
                        const historyItem = (input as HTMLInputElement).closest('.history-item');
                        return {
                            timestamp: Number((input as HTMLInputElement).getAttribute('data-timestamp')),
                            text: historyItem?.querySelector('[data-text]')?.getAttribute('data-text') || '',
                            tags: Array.from(historyItem?.querySelectorAll('.b3-chip__content') || []).map(tag => tag.textContent)
                        };
                    })
                    .filter(item => item.text);

                if (selectedItems.length === 0) {
                    showMessage(this.i18n.note.noItemSelected);
                    return;
                }

                // 合并内容和标签
                const mergedText = selectedItems.map(item => item.text).join('\n\n');
                const mergedTags = Array.from(new Set(selectedItems.flatMap(item => item.tags)));

                // 创建新的小记
                await this.saveContent(mergedText, mergedTags);

                // 询问是否删除已合并的小记
                confirm(this.i18n.note.mergeDeleteConfirm, this.i18n.note.mergeDeleteConfirmTitle, async () => {
                    try {
                        // 删除已合并的小记
                        const timestamps = selectedItems.map(item => item.timestamp);
                        this.historyService.batchDeleteItems(timestamps);
                    } catch (error) {
                        console.error('删除已合并的小记失败:', error);
                        showMessage(this.i18n.note.mergeDeleteFailed);
                    }
                    // 取消选择模式
                    cancelSelectBtn.click();
                    this.renderDockerToolbar();
                    this.renderDockHistory();
                    showMessage(this.i18n.note.mergeSuccess);
                }, () => {
                    // 用户取消删除，只取消选择模式
                    cancelSelectBtn.click();
                    this.renderDockerToolbar();
                    this.renderDockHistory();
                });
            };
        }

        // 批量标签修改功能
        const batchTagBtn = container.querySelector('.batch-tag-btn') as HTMLButtonElement;
        if (batchTagBtn) {
            batchTagBtn.onclick = () => {
                let historyList = element.querySelector('.history-list');
                const selectedTimestamps = Array.from(historyList.querySelectorAll('.batch-checkbox input:checked'))
                    .map(input => Number((input as HTMLInputElement).getAttribute('data-timestamp')));

                if (selectedTimestamps.length === 0) {
                    showMessage(this.i18n.note.noItemSelected);
                    return;
                }

                // 创建标签面板
                const tagPanel = document.createElement('div');
                tagPanel.className = 'tag-panel';
                tagPanel.style.cssText = `
                   position: fixed;
                   z-index: 205;
                   width: 133px;
                   height: 150px;
                   background: var(--b3-menu-background);
                   border: 1px solid var(--b3-border-color);
                   border-radius: var(--b3-border-radius);
                   box-shadow: var(--b3-dialog-shadow);
                   display: flex;
                   flex-direction: column;
                   padding: 0;
                   overflow: hidden;
               `;

                // 计算位置
                const btnRect = batchTagBtn.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const panelHeight = 150;
                const margin = 8;

                // 判断是否有足够空间在上方显示
                const showAbove = btnRect.top > panelHeight + margin;
                const top = showAbove ?
                    btnRect.top - panelHeight - margin :
                    btnRect.bottom + margin;

                tagPanel.style.top = `${top}px`;
                tagPanel.style.left = `${btnRect.left}px`;

                // 如果面板会超出视口右侧，则向左对齐
                if (btnRect.left + 133 > window.innerWidth) {
                    tagPanel.style.left = `${btnRect.left + btnRect.width - 133}px`;
                }

                // 获取所有已有标签
                const allTags = Array.from(new Set(this.historyService.getCurrentData()
                    ?.flatMap(item => item.tags || []) || []));

                // 修改面板内容结构
                tagPanel.innerHTML = `
                   <div style="padding: 8px; border-bottom: 1px solid var(--b3-border-color); background: var(--b3-menu-background); flex-shrink: 0;">
                       <input type="text" 
                           class="b3-text-field fn__flex-1 tag-input" 
                           placeholder="${this.i18n.note.addTag}..."
                           style="width: 100%; background: var(--b3-theme-background);">
                   </div>
                   <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--b3-menu-background);">
                       <div style="padding: 8px 8px 4px 8px; font-size: 12px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;">
                           ${this.i18n.note.existingTags}
                       </div>
                       <div class="history-tags" style="padding: 0 8px 8px 8px; overflow-y: auto; flex: 1;">
                           <div style="display: flex; flex-direction: column; gap: 4px;">
                               ${allTags.length > 0 ?
                        allTags
                            .sort((a, b) => {
                                const countA = this.historyService.getCurrentData()?.filter(item => item.tags?.includes(a)).length;
                                const countB = this.historyService.getCurrentData()?.filter(item => item.tags?.includes(b)).length;
                                return countB - countA;
                            })
                            .map(tag => `
                                        <div class="history-tag b3-chip b3-chip--middle" 
                                            style="cursor: pointer; padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; background: var(--b3-menu-background);" 
                                            data-tag="${tag}">
                                            <span class="b3-chip__content" style="max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                ${tag}
                                            </span>
                                            <span class="tag-count" style="margin-left: 4px; font-size: 10px; opacity: 0.7;">
                                                ${this.historyService.getCurrentData().filter(item => item.tags?.includes(tag)).length}
                                            </span>
                                        </div>
                                    `).join('')
                        : `<div style="color: var(--b3-theme-on-surface-light); font-size: 12px; text-align: center; padding: 8px;">
                               ${this.i18n.note.noTags}
                              </div>`
                    }
                           </div>
                       </div>
                   </div>
               `;

                // 将面板添加到文档根节点
                document.body.appendChild(tagPanel);

                // 获取输入框元素
                const tagInput = tagPanel.querySelector('.tag-input') as HTMLInputElement;
                tagInput.focus();

                // 添加标签的函数
                const addTag = async (tagText: string) => {
                    if (tagText.trim()) {
                        // 更新选中小记的标签

                        if (selectedTimestamps.length > 0) {
                            this.historyService.batchUpdateTags(selectedTimestamps, [tagText.trim()]);
                            showMessage(this.i18n.note.tagSuccess);

                            // 取消选择模式并关闭面板
                            const cancelSelectBtn = container.querySelector('.cancel-select-btn');
                            if (cancelSelectBtn) {
                                (cancelSelectBtn as HTMLElement).click();
                            }
                            tagPanel.remove();
                            document.removeEventListener('click', closePanel);
                            this.renderDockerToolbar()
                            this.renderDockHistory();
                        }
                    }
                };

                // 回车添加标签
                tagInput.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const searchText = tagInput.value.trim();
                        if (searchText) {
                            // 检查是否有匹配的已有标签
                            const matchingTag = Array.from(tagPanel.querySelectorAll('.history-tag'))
                                .find(tag => tag.getAttribute('data-tag').toLowerCase() === searchText.toLowerCase());

                            if (matchingTag) {
                                // 如果有完全匹配的标签，直接使用该标签
                                await addTag(matchingTag.getAttribute('data-tag'));
                            } else {
                                // 如果没有完全匹配的标签，创建新标签
                                await addTag(searchText);
                            }
                        }
                    }
                });

                // 点击历史标签直接添加
                tagPanel.addEventListener('click', async (e) => {
                    const target = e.target as HTMLElement;
                    const tagChip = target.closest('.history-tag') as HTMLElement;
                    if (tagChip) {
                        const tagText = tagChip.getAttribute('data-tag');
                        if (tagText) {
                            await addTag(tagText);
                        }
                    }
                });

                // 添加搜索功能
                tagInput.addEventListener('input', (e) => {
                    const searchText = (e.target as HTMLInputElement).value.toLowerCase();
                    const historyTags = tagPanel.querySelectorAll('.history-tag');

                    historyTags.forEach(tag => {
                        const tagText = tag.getAttribute('data-tag').toLowerCase();
                        if (tagText.includes(searchText)) {
                            (tag as HTMLElement).style.display = 'flex';
                        } else {
                            (tag as HTMLElement).style.display = 'none';
                        }
                    });

                    // 如果没有匹配的标签，显示"无匹配标签"提示
                    const visibleTags = Array.from(historyTags).filter(tag =>
                        (tag as HTMLElement).style.display !== 'none'
                    );

                    const noMatchMessage = tagPanel.querySelector('.no-match-message');
                    if (visibleTags.length === 0 && searchText) {
                        if (!noMatchMessage) {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'no-match-message';
                            messageDiv.style.cssText = 'color: var(--b3-theme-on-surface-light); font-size: 12px; text-align: center; padding: 8px;';
                            messageDiv.textContent = this.i18n.note.noMatchingTags;
                            tagPanel.querySelector('.history-tags').appendChild(messageDiv);
                        }
                    } else if (noMatchMessage) {
                        noMatchMessage.remove();
                    }
                });

                // 点击其他地方关闭面板
                const closePanel = (e: MouseEvent) => {
                    if (!tagPanel.contains(e.target as Node) && !batchTagBtn.contains(e.target as Node)) {
                        tagPanel.remove();
                        document.removeEventListener('click', closePanel);
                    }
                };

                // 延迟添加点击事件，避免立即触发
                setTimeout(() => {
                    document.addEventListener('click', closePanel);
                }, 0);

                // 添加标签悬停效果
                tagPanel.querySelectorAll('.history-tag').forEach(tag => {
                    tag.addEventListener('mouseenter', () => {
                        (tag as HTMLElement).style.backgroundColor = 'var(--b3-theme-primary-light)';
                    });
                    tag.addEventListener('mouseleave', () => {
                        (tag as HTMLElement).style.backgroundColor = '';
                    });
                });
            };
        }

        // 设置搜索功能
        this.setupSearchFeature(element);

        // 设置排序功能
        this.setupSortFeature(element);

        // // 设置标签过滤功能
        this.setupFilterFeature(element);
    }
    private renderDockHistory() {
        if (!this.element) {
            return;
        }
        let element = this.element;
        this.historyService.setItemsPerPage(this.itemsPerPage);
        this.historyService.setIsDescending(this.isDescending);
        this.historyService.setShowArchived(this.showArchived);
        const filteredHistory = this.historyService.getFilteredHistory(true);
        let historyHtml = '';

        // 添加下拉刷新指示器
        if (isMobile()) {
            historyHtml += `
                <div class="pull-to-refresh" style="
                    height: 60px;
                    margin-top: -60px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--b3-theme-on-surface-light);
                    font-size: 14px;
                    transition: all 0.3s;
                    transform: translateY(0);
                ">
                    <div class="pull-to-refresh-content">
                        <svg class="b3-button__icon" style="height: 20px; width: 20px; transition: all 0.3s;">
                            <use xlink:href="#iconRefresh"></use>
                        </svg>
                        <span class="pull-text">${this.i18n.note.pullToRefresh || '下拉刷新'}</span>
                    </div>
                </div>`;
        }

        // 添加归档状态指示
        if (this.historyService.isArchiveView()) {
            historyHtml += `
                <div class="fn__flex-center" style="padding: 8px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface); font-size: 12px;">
                    <svg class="b3-button__icon" style="height: 14px; width: 14px; margin-right: 4px;">
                        <use xlink:href="#iconArchive"></use>
                    </svg>
                    ${this.i18n.note.archivedView}
                </div>`;
        }

        // 渲染置顶记录
        if (filteredHistory.pinnedItems.length > 0) {
            historyHtml += this.renderPinnedHistory(filteredHistory.pinnedItems);
        }

        // 渲染非置顶记录，但只显示当前限制数量的记录
        const displayedUnpinnedItems = filteredHistory.unpinnedItems.slice(0, this.currentDisplayCount);
        if (displayedUnpinnedItems.length > 0) {
            historyHtml += this.renderUnpinnedHistory(displayedUnpinnedItems, filteredHistory.pinnedItems.length > 0);
        }

        // 添加加载状态指示器
        const totalUnpinnedCount = filteredHistory.unpinnedItems.length;
        if (totalUnpinnedCount > this.currentDisplayCount) {
            historyHtml += `
                <div class="loading-indicator fn__flex-center" style="padding: 16px 0; color: var(--b3-theme-on-surface-light); font-size: 12px;">
                    ${this.i18n.note.loading}
                </div>`;
        } else if (displayedUnpinnedItems.length > 0) {
            historyHtml += this.renderNoMoreItems();
        }

        let historyContent = `<div class="history-content">${historyHtml}</div>`;
        const historyList = element.querySelector('.history-list');
        historyList.innerHTML = historyContent;

        // 添加下拉刷新事件处理
        if (isMobile()) {
            let startY = 0;
            let currentY = 0;
            let isRefreshing = false;
            const historyContent = historyList.querySelector('.history-content');
            const pullToRefresh = historyList.querySelector('.pull-to-refresh');
            const pullIcon = pullToRefresh?.querySelector('svg');
            const pullText = pullToRefresh?.querySelector('.pull-text');

            historyList.addEventListener('touchstart', (e: TouchEvent) => {
                if (historyList.scrollTop === 0 && !isRefreshing) {
                    startY = e.touches[0].clientY;
                }
            });

            historyList.addEventListener('touchmove', (e: TouchEvent) => {
                if (historyList.scrollTop === 0 && !isRefreshing) {
                    currentY = e.touches[0].clientY;
                    const distance = currentY - startY;
                    
                    if (distance > 0) {
                        e.preventDefault();
                        const pullDistance = Math.min(distance * 0.5, 60);
                        historyContent.style.transform = `translateY(${pullDistance}px)`;
                        pullToRefresh.style.transform = `translateY(${pullDistance}px)`;
                        
                        if (pullDistance >= 60) {
                            pullIcon.style.transform = 'rotate(180deg)';
                            pullText.textContent = this.i18n.note.releaseToRefresh || '释放刷新';
                        } else {
                            pullIcon.style.transform = 'rotate(0deg)';
                            pullText.textContent = this.i18n.note.pullToRefresh || '下拉刷新';
                        }
                    }
                }
            });

            historyList.addEventListener('touchend', async () => {
                if (historyList.scrollTop === 0 && !isRefreshing) {
                    const distance = currentY - startY;
                    if (distance >= 60) {
                        isRefreshing = true;
                        pullIcon.style.transform = 'rotate(360deg)';
                        pullText.textContent = this.i18n.note.refreshing || '正在刷新...';
                        
                        // 执行刷新操作
                        this.currentDisplayCount = this.itemsPerPage;
                        await this.loadNoteData();
                        this.renderDockHistory();
                        
                        // 重置状态
                        setTimeout(() => {
                            historyContent.style.transform = 'translateY(0)';
                            pullToRefresh.style.transform = 'translateY(0)';
                            isRefreshing = false;
                        }, 300);
                    } else {
                        historyContent.style.transform = 'translateY(0)';
                        pullToRefresh.style.transform = 'translateY(0)';
                    }
                }
            });
        }

        // 添加滚动监听器
        const handleScroll = () => {
            const scrollContainer = historyList;
            const scrollPosition = scrollContainer.scrollTop + scrollContainer.clientHeight;
            const scrollHeight = scrollContainer.scrollHeight;
            const threshold = 100; // 距离底部多少像素时触发加载

            if (scrollHeight - scrollPosition <= threshold && totalUnpinnedCount > this.currentDisplayCount) {
                // 移除滚动监听器，防止重复触发
                scrollContainer.removeEventListener('scroll', handleScroll);

                // 使用设置中的值增加显示数量
                const itemsPerPage = ITEMS_PER_PAGE;
                this.currentDisplayCount += itemsPerPage;

                // 获取新的要显示的记录
                const newItems = filteredHistory.unpinnedItems.slice(
                    this.currentDisplayCount - itemsPerPage,
                    this.currentDisplayCount
                );

                // 渲染并追加新的记录
                if (newItems.length > 0) {
                    const loadingIndicator = scrollContainer.querySelector('.loading-indicator');
                    if (loadingIndicator) {
                        const newContent = this.renderUnpinnedHistory(newItems, false);
                        loadingIndicator.insertAdjacentHTML('beforebegin', newContent);
                    }

                    // 更新加载状态
                    if (totalUnpinnedCount <= this.currentDisplayCount) {
                        // 没有更多内容了
                        loadingIndicator.outerHTML = this.renderNoMoreItems();
                    } else {
                        // 重新添加滚动监听器
                        setTimeout(() => {
                            scrollContainer.addEventListener('scroll', handleScroll);
                        }, 100);
                    }

                    // 重新绑定新添加内容的事件处理
                    this.bindHistoryListEvents();
                }
            }
        };

        // 添加滚动监听器
        historyList.addEventListener('scroll', handleScroll);

        // 监听历史记录点击事件
        this.bindHistoryListEvents();
    }

    // 设置历史小记中的编辑、复制、删除事件
    private bindHistoryListEvents() {
        let element = this.element;
        let historyList = element.querySelector('.history-list');

        // 移除旧的事件监听器
        historyList.removeEventListener('click', this.historyClickHandler);

        // 添加拖拽相关的事件处理
        historyList.addEventListener('dragstart', (e: DragEvent) => {
            const target = e.target as HTMLElement;
            const textContent = target.closest('.text-content');
            if (textContent) {
                const text = textContent.getAttribute('data-text');
                if (text && e.dataTransfer) {
                    // 设置拖拽效果为"copy"
                    e.dataTransfer.dropEffect = 'copy';
                    e.dataTransfer.effectAllowed = 'copy';

                    // 设置纯文本格式
                    e.dataTransfer.setData('text/plain', text);

                    // 生成思源块 ID
                    const blockId = `${Date.now()}0${Math.random().toString().substring(2, 6)}`;

                    // 设置思源特定的格式
                    e.dataTransfer.setData('application/x-siyuan', JSON.stringify({
                        id: blockId,
                        type: "NodeParagraph",
                        content: text
                    }));

                    // 设置HTML格式 - 使用思源的块结构
                    const markdownContent = window.Lute.New().Md2HTML(text);
                    const fullHtml = `<div data-node-id="${blockId}" data-type="NodeParagraph" class="protyle-wysiwyg__paragraph" data-subtype="p">${markdownContent}</div>`;
                    e.dataTransfer.setData('text/html', fullHtml);

                    // 添加拖拽时的视觉反馈
                    target.style.opacity = '0.5';

                    // 创建拖拽图像
                    const dragImage = document.createElement('div');
                    dragImage.style.position = 'fixed';
                    dragImage.style.top = '-9999px';
                    dragImage.style.left = '-9999px';
                    dragImage.style.zIndex = '-1';
                    dragImage.style.maxWidth = '360px';
                    dragImage.style.pointerEvents = 'none';

                    // 使用思源的块样式
                    dragImage.innerHTML = `
                        <div class="protyle-wysiwyg__paragraph" data-node-id="${blockId}" data-type="NodeParagraph" style="
                            margin-bottom: 8px; 
                            padding: 8px; 
                            border: 1px solid var(--b3-border-color); 
                            border-radius: 4px; 
                            background: var(--b3-theme-background);
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
                            ${markdownContent}
                        </div>`;

                    document.body.appendChild(dragImage);
                    e.dataTransfer.setDragImage(dragImage, 0, 0);

                    // 拖拽结束后移除临时元素
                    setTimeout(() => {
                        document.body.removeChild(dragImage);
                    }, 0);
                }
            }
        });

        historyList.addEventListener('dragend', (e: DragEvent) => {
            const target = e.target as HTMLElement;
            // 恢复透明度
            target.style.opacity = '1';
             // 检查拖拽是否成功
            if (e.dataTransfer && e.dataTransfer.dropEffect === 'none') {
                // 拖拽未成功
                showMessage("拖拽失败");
            } else if (e.dataTransfer && e.dataTransfer.dropEffect === 'copy') {
                // 拖拽成功
                showMessage("拖拽成功");
            }
            
        });

        // 创建新的事件处理函数
        this.historyClickHandler = async (e) => {
            const target = e.target as HTMLElement;
            // console.log("target", target);

            // 添加对复选框的处理
            if (target.classList.contains('task-list-item-checkbox')) {
                e.stopPropagation();
                const timestamp = Number(target.getAttribute('data-timestamp'));
                const originalMark = target.getAttribute('data-original');
                const newMark = target.checked ? '[x]' : '[]';
                // 更新数据
                const note = this.historyService.getHistoryItem(timestamp);

                if (note) {
                    // 获取当前任务项的完整文本
                    const taskItemText = target.nextElementSibling.textContent.trim();

                    // 使用更精确的替换方法
                    const oldTaskItem = `${originalMark} ${taskItemText}`;
                    const newTaskItem = `${newMark} ${taskItemText}`;
                    note.text = note.text.replace(oldTaskItem, newTaskItem);
                    await this.historyService.updateItemContent(timestamp, note.text);

                    // 更新 data-original 属性
                    target.setAttribute('data-original', newMark);

                    // 添加视觉反馈
                    const textSpan = target.nextElementSibling as HTMLElement;
                    if (textSpan) {
                        textSpan.style.textDecoration = target.checked ? 'line-through' : 'none';
                        textSpan.style.opacity = target.checked ? '0.6' : '1';
                    }

                    // 添加操作成功的提示
                    // showMessage(target.checked ? '已完成任务' : '已取消完成');
                }
                return;
            }

            if (!isMobile()) {
                // 添加提醒按钮点击处理
                const reminderBtn = target.closest('.reminder-btn');
                if (reminderBtn) {
                    e.stopPropagation();
                    const timestamp = Number(reminderBtn.getAttribute('data-timestamp'));
                    const success = await this.reminderService.updateReminderTime(timestamp);
                    if (success) {
                        this.renderDockHistory();
                    }
                    return;
                }
            }

            // 其他现有的事件处理代码.
            const moreBtn = target.closest('.more-btn') as HTMLElement;
            const copyBtn = target.closest('.copy-btn') as HTMLElement;
            const editBtn = target.closest('.edit-btn') as HTMLElement;
            const toggleBtn = target.closest('.toggle-text');
            const deleteBtn = target.closest('.delete-btn') as HTMLElement;
            if (deleteBtn) {
                e.stopPropagation();
                const timestamp = Number(deleteBtn.getAttribute('data-timestamp'));
                confirm(this.i18n.note.delete, this.i18n.note.deleteConfirm, async () => {
                    this.historyService.deleteItem(timestamp);
                    this.renderDockerToolbar();
                    this.renderDockHistory();
                });
                return;
            }

            if (copyBtn) {
                e.stopPropagation();
                const textContainer = copyBtn.closest('.history-item').querySelector('[data-text]');
                if (textContainer) {
                    const text = textContainer.getAttribute('data-text') || '';
                    try {
                        await navigator.clipboard.writeText(text);
                        showMessage(this.i18n.note.copySuccess);
                    } catch (err) {
                        console.error('复制失败:', err);
                        showMessage(this.i18n.note.copyFailed);
                    }
                }
            } else if (editBtn) {
                e.stopPropagation();
                const timestamp = Number(editBtn.getAttribute('data-timestamp'));
                await this.editHistoryItem(timestamp)
            } else if (moreBtn) {
                e.stopPropagation();
                const timestamp = Number(moreBtn.getAttribute('data-timestamp'));
                const rect = moreBtn.getBoundingClientRect();

                // 获取当前记录项
                const currentItem = this.historyService.getHistoryItem(timestamp);

                // 获取插入按钮的图标和文本
                const insertMode = this.settingUtils.get("insertMode");
                const insertBtnLabel = insertMode === "doc" ? this.i18n.note.insertToDoc : this.i18n.note.insertToDaily;
                const insertBtnIcon = insertMode === "doc" ? "iconInsertDoc" : "iconCalendar";

                const menu = new Menu("historyItemMenu");
                if (!menu) {
                    console.error("Failed to create menu");
                    return;
                }

                if (!isMobile()) {
                    // 添加提醒选项
                    const existingReminder = this.reminderService.getReminder(timestamp);
                    menu.addItem({
                        icon: "iconClock",
                        label: existingReminder ? this.i18n.note.deleteReminder : this.i18n.note.setReminder,
                        click: async () => {
                            menu.close();
                            if (existingReminder) {
                                this.reminderService.deleteReminder(timestamp);
                                this.renderDockHistory();
                            } else {
                                const success = await this.reminderService.setReminder(timestamp, currentItem.text);
                                if (success) {
                                    this.renderDockHistory();
                                }
                            }
                        }
                    });
                     // 添加分享选项
                    menu.addItem({
                        icon: "iconCustomShare",
                        label: this.i18n.note.share,
                        click: async () => {
                            menu.close();
                            this.generateShareImage(timestamp);
                        }
                    });
                } else {
                    // 移动端添加编辑选项
                    menu.addItem({
                        icon: "iconEdit",
                        label: this.i18n.note.edit,
                        click: async () => {
                            menu.close();
                            await this.editHistoryItem(timestamp);
                        }
                    });

                    // 移动端添加置顶选项
                    menu.addItem({
                        icon: "iconPin",
                        label: currentItem.isPinned ? this.i18n.note.unpin : this.i18n.note.pin,
                        click: async () => {
                            menu.close();
                            await this.historyService.toggleItemPin(timestamp);
                            this.renderDockHistory();
                        }
                    });

                    // 移动端添加归档选项
                    menu.addItem({
                        icon: "iconArchive",
                        label: this.showArchived ? this.i18n.note.unarchive : this.i18n.note.archive,
                        click: async () => {
                            menu.close();
                            if (this.showArchived) {
                                await this.historyService.unarchiveItem(timestamp);
                            } else {
                                await this.historyService.archiveItem(timestamp);
                            }
                            this.renderDockerToolbar();
                            this.renderDockHistory();
                        }
                    });
                }

            
                // 添加删除选项
                menu.addItem({
                    icon: "iconTrashcan",
                    label: this.i18n.note.delete,
                    click: async () => {
                        confirm(this.i18n.note.delete, this.i18n.note.deleteConfirm, async () => {
                            this.historyService.deleteItem(timestamp);
                            menu.close();
                            this.renderDockerToolbar();
                            this.renderDockHistory();
                        })
                    }
                });


                menu.open({
                    x: rect.right,
                    y: rect.bottom,
                    isLeft: true,
                });
            } else if (toggleBtn) {
                const textContent = toggleBtn.closest('.text-content');
                const collapsedText = textContent.querySelector('.collapsed-text');
                const expandedText = textContent.querySelector('.expanded-text');

                if (collapsedText.style.display !== 'none') {
                    // 展开
                    collapsedText.style.display = 'none';
                    expandedText.style.display = 'inline';
                    toggleBtn.innerHTML = `${this.i18n.note.collapse}
                        <svg class="b3-button__icon" style="height: 12px; width: 12px; margin-left: 2px; transform: rotate(180deg); transition: transform 0.2s ease;">
                            <use xlink:href="#iconDown"></use>
                        </svg>`;
                } else {
                    // 折叠
                    collapsedText.style.display = 'inline';
                    expandedText.style.display = 'none';
                    toggleBtn.innerHTML = `${this.i18n.note.expand}
                        <svg class="b3-button__icon" style="height: 12px; width: 12px; margin-left: 2px; transform: rotate(0deg); transition: transform 0.2s ease;">
                            <use xlink:href="#iconDown"></use>
                        </svg>`;
                }
                e.stopPropagation();
            }

            // 添加图片点击处理
            if (target.classList.contains('zoomable-image')) {
                e.stopPropagation();
                const img = target as HTMLImageElement;

                // 创建对话框
                const dialog = new Dialog({
                    title: '',
                    content: `<div class="image-preview" style="text-align: center; padding: 16px;">
                        <img src="${img.src}" style="max-width: 100%; max-height: 80vh; object-fit: contain;">
                    </div>`,
                    width: '80vw',
                });

                // 添加关闭按钮
                const closeBtn = document.createElement('button');
                closeBtn.className = 'b3-button b3-button--text';
                closeBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>`;
                closeBtn.style.position = 'absolute';
                closeBtn.style.top = '8px';
                closeBtn.style.right = '8px';
                closeBtn.onclick = () => dialog.destroy();

                dialog.element.querySelector('.b3-dialog__header').appendChild(closeBtn);

                return;
            }

            // 添加置顶按钮点击处理
            const pinBtn = target.closest('.pin-btn');
            if (pinBtn) {
                e.stopPropagation();
                const timestamp = Number(pinBtn.getAttribute('data-timestamp'));
                await this.historyService.toggleItemPin(timestamp);
                this.renderDockHistory();
                return;
            }

            // 添加归档按钮点击处理
            const archiveBtn = target.closest('.archive-btn');
            if (archiveBtn) {
                e.stopPropagation();
                const timestamp = Number(archiveBtn.getAttribute('data-timestamp'));
                if (this.showArchived) {
                    await this.historyService.unarchiveItem(timestamp);
                } else {
                    await this.historyService.archiveItem(timestamp);
                }
                this.renderDockerToolbar();
                this.renderDockHistory();
                return;
            }

            // 添加新建文档按钮点击处理
            const createDocBtn = target.closest('.create-doc-btn');
            if (createDocBtn) {
                e.stopPropagation();
                const timestamp = Number(createDocBtn.getAttribute('data-timestamp'));
                await this.createNoteAsDocument(timestamp);
                return;
            }

            // 添加插入到今日笔记按钮点击处理
            const insertDailyBtn = target.closest('.insert-daily-btn');
            if (insertDailyBtn) {
                e.stopPropagation();
                const timestamp = Number(insertDailyBtn.getAttribute('data-timestamp'));
                await this.insertToDaily(timestamp);
                return;
            }
        };

        // 添加新的事件监听器
        historyList.addEventListener('click', this.historyClickHandler);
    }

    private bindDockPanelEvents() {
        let element = this.element;

        // 设置导出功能
        this.setupExportFeature(element);
        this.imageService.setupImageUpload({
            container: element,
            i18n: this.i18n
        });
    };


    // 渲染置顶记录
    private renderPinnedHistory(pinnedHistory: Array<{ text: string, timestamp: number, isPinned?: boolean, tags?: string[] }>) {
        return `<div class="pinned-records" style="margin-top: 8px;">
            ${pinnedHistory.map(item => `
                <div class="history-item" style="margin-bottom: 8px; padding: 8px; 
                    border: 1px solid var(--b3-theme-primary); 
                    border-radius: 8px; 
                    background: var(--b3-theme-background); 
                    transition: all 0.2s ease; 
                    user-select: text;
                    position: relative;" 
                    onmouseover="this.style.boxShadow='0 2px 8px rgba(0, 0, 0, 0.1)';
                                this.querySelector('.action-buttons').style.opacity='1';" 
                    onmouseout="this.style.boxShadow='none';
                               this.querySelector('.action-buttons').style.opacity='0';">
                    <div class="fn__flex" style="align-items: center; margin-bottom: 4px;">
                        <svg class="b3-button__icon" style="height: 16px; width: 16px; color: var(--b3-theme-primary);">
                            <use xlink:href="#iconPin"></use>
                        </svg>
                        <span style="margin-left: 4px; font-size: 12px; color: var(--b3-theme-primary);">
                            ${this.i18n.note.pinned}
                        </span>
                    </div>
                    ${this.renderNoteContent(item)}
                </div>
            `).join('')}
        </div>`;
    }

    // 渲染非置顶记录
    private renderUnpinnedHistory(displayHistory: Array<{ text: string, timestamp: number, isPinned?: boolean, tags?: string[] }>, hasPinned: boolean) {
        return `<div style="margin-top: ${hasPinned ? '16px' : '8px'}">
            ${displayHistory.map(item => `
                <div class="history-item" style="margin-bottom: 8px; padding: 8px; 
                    border: 1px solid var(--b3-border-color); 
                    border-radius: 8px; 
                    transition: all 0.2s ease; 
                    user-select: text;
                    position: relative;
                     background-color: var(--b3-theme-background);" 
                    onmouseover="this.style.boxShadow='0 2px 8px rgba(0, 0, 0, 0.1)'; 
                                this.style.borderColor='var(--b3-theme-primary-light)';
                                this.querySelector('.action-buttons').style.opacity='1';" 
                    onmouseout="this.style.boxShadow='none'; 
                               this.style.borderColor='var(--b3-border-color)';
                               this.querySelector('.action-buttons').style.opacity='0';">
                    ${this.renderNoteContent(item)}
                </div>
            `).join('')}
        </div>`;
    }

    // 渲染笔记内容
    private renderNoteContent(item: { text: string, timestamp: number, tags?: string[] }) {
        const maxTextLength = this.settingUtils.get("maxTextLength") || MAX_TEXT_LENGTH;
        const displayText = item.text;
        const encodeText = (text: string) => {
            return text.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        // 处理图片路径转义
        const processImagePaths = (content: string) => {
            return content.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, url) => {
                return `![${alt}](${encodeURI(url)})`;
            });
        };

        // 预处理文本，保留空行
        const preserveEmptyLines = (content: string) => {
            return content.replace(/\n\n/g, '\n&nbsp;\n');
        };


        // 处理任务列表
        const processTaskList = (content: string) => {
            // 使用捕获组来保存原始的方括号格式
            return content.replace(
                /(\[[ ]?\]|\[[ ]?x[ ]?\]) ([^\n]*)/g,
                (match, checkbox, text) => {
                    const isChecked = checkbox.includes('x');
                    // 保持原始的方括号格式
                    const emptyBox = checkbox.includes(' ') ? '[ ]' : '[]';
                    const checkedBox = checkbox.includes(' ') ? '[x ]' : '[x]';
                    const normalizedCheckbox = isChecked ? checkedBox : emptyBox;

                    return `
                        <div class="task-list-item">
                            <input type="checkbox" 
                                class="task-list-item-checkbox" 
                                ${isChecked ? 'checked' : ''} 
                                data-original="${normalizedCheckbox}"  data-timestamp="${item.timestamp}">
                            <span style="${isChecked ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${text.trim()}</span>
                        </div>`;
                }
            );
        };

        // 使用 Lute 渲染 Markdown
        let renderedContent = '';
        try {
            // 先处理图片路径，再进行Markdown渲染
            const processedText = processImagePaths(displayText);
            const textWithEmptyLines = preserveEmptyLines(processedText);
            renderedContent = window.Lute.New().Md2HTML(textWithEmptyLines);
            renderedContent = processTaskList(renderedContent);

            // 添加图片点击事件处理
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = renderedContent;

            // 为所有图片添加点击事件类和样式
            tempDiv.querySelectorAll('img').forEach(img => {
                img.classList.add('zoomable-image');
                img.style.cursor = 'zoom-in';
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
            });

            renderedContent = tempDiv.innerHTML;
        } catch (error) {
            console.error('Markdown rendering failed:', error);
            renderedContent = `<div style="color: var(--b3-theme-on-surface); word-break: break-word; white-space: pre-wrap;">${encodeText(displayText)}</div>`;
        }

        let reminderButton = '';
        if (!isMobile()) {
            // 在 action-buttons div 中添加提醒按钮（如果存在提醒）
            const existingReminder = this.reminderService.getReminder(item.timestamp);
            reminderButton = existingReminder ? `
            <button class="b3-button b3-button--text reminder-btn b3-tooltips b3-tooltips__n" data-timestamp="${item.timestamp}" 
                style="padding: 4px; height: 20px; width: 20px;" 
                aria-label="${new Date(existingReminder.reminderTime).toLocaleString()}">
                <svg class="b3-button__icon" style="height: 14px; width: 14px; color: var(--b3-theme-on-surface-light);">
                    <use xlink:href="#iconClock"></use>
                </svg>
            </button>
        ` : '';
        }

        // 修改插入按钮的文本和提示
        const insertMode = this.settingUtils.get("insertMode");
        const insertBtnLabel = insertMode === "doc" ? this.i18n.note.insertToDoc : this.i18n.note.insertToDaily;
        const insertBtnIcon = insertMode === "doc" ? "iconInsertDoc" : "iconCalendar";

        if (isMobile()) {

            return `
        <div class="fn__flex" style="gap: 8px;">
            <!-- 添加复选框，默认隐藏 -->
            <div class="${this.isBatchSelect ? 'batch-checkbox' : 'batch-checkbox fn__none'}" style="padding-top: 2px;">
                <input type="checkbox" class="b3-checkbox" data-timestamp="${item.timestamp}">
            </div>
            <div class="fn__flex-1">
                <!-- 移动时间和更多按钮到头部 -->
                <div class="fn__flex" style="margin-bottom: 4px; justify-content: space-between; align-items: center;">
                    <span style="font-size: 12px; color: var(--b3-theme-on-surface-light);">
                        ${new Date(item.timestamp).toLocaleString()}
                    </span>
                    <button class="b3-button b3-button--text more-btn" data-timestamp="${item.timestamp}" 
                        style="padding: 4px; height: 20px; width: 20px;">
                        <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                            <use xlink:href="#iconMore"></use>
                        </svg>
                    </button>
                </div>
                <div class="text-content" data-text="${encodeText(displayText)}" >
                    ${item.text.length > maxTextLength ?
                    `<div style="word-break: break-word;">
                            <div class="collapsed-text markdown-content" style="color: var(--b3-theme-on-surface);">
                                ${window.Lute.New().Md2HTML(displayText.substring(0, maxTextLength))}...
                            </div>
                            <div class="expanded-text markdown-content" style="display: none; color: var(--b3-theme-on-surface);">
                                ${renderedContent}
                            </div>
                            <button class="b3-button b3-button--text toggle-text" 
                                style="padding: 0 4px; font-size: 12px; color: var(--b3-theme-primary); display: inline-flex; align-items: center;">
                                ${this.i18n.note.expand}
                                <svg class="b3-button__icon" style="height: 12px; width: 12px; margin-left: 2px; transition: transform 0.2s ease;">
                                    <use xlink:href="#iconDown"></use>
                                </svg>
                            </button>
                        </div>`
                    : `<div class="markdown-content" style="color: var(--b3-theme-on-surface); word-break: break-word;">
                            ${renderedContent}
                        </div>`}
                </div>
                ${item.tags && item.tags.length > 0 ? `
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
                        ${item.tags.map(tag => `
                            <span class="b3-chip b3-chip--small b3-tooltips b3-tooltips__n" 
                                style="padding: 0 6px; height: 18px; font-size: 10px;"
                                aria-label="${tag}">
                                <span class="b3-chip__content" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tag}</span>
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        </div>`;
        }
        return `
            <div class="fn__flex" style="gap: 8px;">
                <!-- 添加复选框，默认隐藏 -->
                <div class="${this.isBatchSelect ? 'batch-checkbox' : 'batch-checkbox fn__none'}" style="padding-top: 2px;">
                    <input type="checkbox" class="b3-checkbox" data-timestamp="${item.timestamp}">
                </div>
                <div class="fn__flex-1">
                    <!-- 移动时间和提醒按钮到头部 -->
                    <div class="fn__flex" style="margin-bottom: 4px; justify-content: space-between; align-items: center;">
                        <div class="fn__flex" style="align-items: center; gap: 4px;">
                            <span style="font-size: 12px; color: var(--b3-theme-on-surface-light);">
                                ${new Date(item.timestamp).toLocaleString()}
                            </span>
                            ${reminderButton}
                        </div>
                    </div>
                    <div class="text-content" data-text="${encodeText(displayText)}" draggable="true">
                        ${item.text.length > maxTextLength ?
                `<div style="word-break: break-word;">
                                <div class="collapsed-text markdown-content" style="color: var(--b3-theme-on-surface);">
                                    ${window.Lute.New().Md2HTML(displayText.substring(0, maxTextLength))}...
                                </div>
                                <div class="expanded-text markdown-content" style="display: none; color: var(--b3-theme-on-surface);">
                                    ${renderedContent}
                                </div>
                                <button class="b3-button b3-button--text toggle-text" 
                                    style="padding: 0 4px; font-size: 12px; color: var(--b3-theme-primary); display: inline-flex; align-items: center;">
                                    ${this.i18n.note.expand}
                                    <svg class="b3-button__icon" style="height: 12px; width: 12px; margin-left: 2px; transition: transform 0.2s ease;">
                                        <use xlink:href="#iconDown"></use>
                                    </svg>
                                </button>
                            </div>`
                : `<div class="markdown-content" style="color: var(--b3-theme-on-surface); word-break: break-word;">
                                ${renderedContent}
                            </div>`}
                    </div>
                    ${item.tags && item.tags.length > 0 ? `
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
                            ${item.tags.map(tag => `
                                <span class="b3-chip b3-chip--small b3-tooltips b3-tooltips__n" 
                                    style="padding: 0 6px; height: 18px; font-size: 10px;"
                                    aria-label="${tag}">
                                    <span class="b3-chip__content" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tag}</span>
                                </span>
                            `).join('')}
                        </div>
                    ` : ''}
                    <div class="fn__flex" style="margin-top: 4px; justify-content: flex-end;">
                        <div class="fn__flex action-buttons" style="gap: 4px; opacity: 0; transition: opacity 0.2s ease;">
                            <button class="b3-button b3-button--text copy-btn b3-tooltips b3-tooltips__n" data-timestamp="${item.timestamp}" 
                                style="padding: 4px; height: 20px; width: 20px;" aria-label="${this.i18n.note.copy}">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                    <use xlink:href="#iconCopy"></use>
                                </svg>
                            </button>
                            <button class="b3-button b3-button--text edit-btn b3-tooltips b3-tooltips__n" data-timestamp="${item.timestamp}" 
                                style="padding: 4px; height: 20px; width: 20px;" aria-label="${this.i18n.note.edit}">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                    <use xlink:href="#iconEdit"></use>
                                </svg>
                            </button>
                            <button class="b3-button b3-button--text insert-daily-btn b3-tooltips b3-tooltips__n" data-timestamp="${item.timestamp}" 
                                style="padding: 4px; height: 20px; width: 20px;" 
                                aria-label="${insertBtnLabel}">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                    <use xlink:href="#${insertBtnIcon}"></use>
                                </svg>
                            </button>
                            <button class="b3-button b3-button--text create-doc-btn b3-tooltips b3-tooltips__n" data-timestamp="${item.timestamp}" 
                                style="padding: 4px; height: 20px; width: 20px;" 
                                aria-label="${this.i18n.note.createDoc}">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                    <use xlink:href="#iconFile"></use>
                                </svg>
                            </button>
                            <button class="b3-button b3-button--text pin-btn b3-tooltips b3-tooltips__n" data-timestamp="${item.timestamp}" 
                                style="padding: 4px; height: 20px; width: 20px;" 
                                aria-label="${item.isPinned ? this.i18n.note.unpin : this.i18n.note.pin}">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px; ${item.isPinned ? 'color: var(--b3-theme-primary);' : ''}">
                                    <use xlink:href="#iconPin"></use>
                                </svg>
                            </button>
                            <button class="b3-button b3-button--text archive-btn b3-tooltips b3-tooltips__n" data-timestamp="${item.timestamp}" 
                                style="padding: 4px; height: 20px; width: 20px;" 
                                aria-label="${this.showArchived ? this.i18n.note.unarchive : this.i18n.note.archive}">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                    <use xlink:href="#iconArchive"></use>
                                </svg>
                            </button>
                             <button class="b3-button b3-button--text delete-btn b3-tooltips b3-tooltips__n" data-timestamp="${item.timestamp}" 
                                style="padding: 4px; height: 20px; width: 20px; color: var(--b3-theme-error);" 
                                aria-label="${this.i18n.note.delete}">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                    <use xlink:href="#iconTrashcan"></use>
                                </svg>
                            </button>
                            <button class="b3-button b3-button--text more-btn" data-timestamp="${item.timestamp}" 
                                style="padding: 4px; height: 20px; width: 20px;">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px;">
                                    <use xlink:href="#iconMore"></use>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    // 渲染没有更多内容提示
    private renderNoMoreItems() {
        return `
            <div class="fn__flex-center" style="padding: 16px 0; color: var(--b3-theme-on-surface-light); font-size: 12px;">
                ${this.i18n.note.noMore}
            </div>`;
    }

    private async createMobileQuickNote() {
        return new Promise((resolve) => {
            // 创建遮罩层
            const overlay = document.createElement('div');
            overlay.className = 'quick-note-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.4);
                z-index: 100;
                opacity: 0;
                transition: opacity 0.3s ease;
            `;

            // 创建底部弹出层容器
            const bottomSheet = document.createElement('div');
            bottomSheet.className = 'quick-note-bottom-sheet';
            bottomSheet.style.cssText = `
                        position: fixed;
                        bottom: -100%;
                        left: 0;
                        right: 0;
                        background: var(--b3-theme-background);
                        border-radius: 16px 16px 0 0;
                        box-shadow: var(--b3-dialog-shadow);
                        z-index: 100;
                        transition: bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        padding: 16px;
                        max-height: 80vh;
                        display: flex;
                        flex-direction: column;
                    `;

            // 添加顶部拖动条
            bottomSheet.innerHTML = `
                        <div class="bottom-sheet-drag-handle" style="
                            width: 32px;
                            height: 4px;
                            background: var(--b3-theme-background-light);
                            border-radius: 2px;
                            margin: 0 auto 16px;
                        "></div>
                        <div class="b3-dialog__header">
                            <span class="b3-dialog__title">${this.i18n.note.new}</span>
                            <span class="fn__flex-1"></span>
                            <button class="b3-button b3-button--text" data-type="close">
                                <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                            </button>
                        </div>
                        <div class="b3-dialog__content" style="flex: 1; overflow: auto; padding: 16px 0;">
                            ${this.editorService.getEditorTemplate({ text: this.tempNoteContent, i18n: this.i18n })}
                        </div>
                    `;

            document.body.appendChild(overlay);
            document.body.appendChild(bottomSheet);

            // 显示遮罩和底部面板
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                bottomSheet.style.bottom = '0';
            });

            const closeBottomSheet = () => {
                overlay.style.opacity = '0';
                bottomSheet.style.bottom = '-100%';
                setTimeout(() => {
                    document.body.removeChild(overlay);
                    document.body.removeChild(bottomSheet);
                    this.isCreatingNote = false;
                    resolve(false);
                }, 300);
            };

            // 点击遮罩关闭
            overlay.addEventListener('click', closeBottomSheet);

            // 点击关闭按钮关闭
            const closeButton = bottomSheet.querySelector('[data-type="close"]');
            if (closeButton) {
                closeButton.addEventListener('click', closeBottomSheet);
            }

            // 设置编辑器和标签功能
            const textarea = bottomSheet.querySelector('textarea');
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);

                // 添加快捷键事件监听
                textarea.addEventListener('keydown', async (e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        if (textarea.value.trim()) {
                            const tags = Array.from(bottomSheet.querySelectorAll('.tag-item'))
                                .map(tag => tag.getAttribute('data-tag'));
                            this.saveContent(textarea.value, tags);
                            closeBottomSheet();
                            resolve(true);
                        }
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                        e.preventDefault();
                        const addTagBtn = bottomSheet.querySelector('.add-tag-btn') as HTMLElement;
                        if (addTagBtn) {
                            addTagBtn.click();
                        }
                    }
                });
            }

            // 设置标签功能
            this.setupTagsFeature(bottomSheet);

            // 设置图片上传功能
            this.imageService.setupImageUpload({
                container: bottomSheet,
                i18n: this.i18n
            });

            // 绑定保存按钮事件
            const saveBtn = bottomSheet.querySelector('.main_save_btn');
            if (saveBtn && textarea) {
                saveBtn.addEventListener('click', async () => {
                    if (textarea.value.trim()) {
                        const tags = Array.from(bottomSheet.querySelectorAll('.tag-item'))
                            .map(tag => tag.getAttribute('data-tag'));
                        await this.saveContent(textarea.value, tags);
                        closeBottomSheet();
                        resolve(true);
                    }
                });
            }
        });
    }

    // 创建新笔记
    private async createNewNote() {
        // 如果已经有窗口在打开中,则返回
        if (this.isCreatingNote) {
            return false;
        }

        try {
            this.isCreatingNote = true; // 设置标志位
            if (isMobile()) {
                return this.createMobileQuickNote();
            }
            // 桌面端的原有实现
            return new Promise((resolve) => {
                const dialog = new Dialog({
                    title: this.i18n.note.title,
                    content: `
                            <div class="b3-dialog__content" style="box-sizing: border-box; padding: 16px; height: 100%; display: flex; flex-direction: column;">
                                ${this.editorService.getEditorTemplate({ text: this.tempNoteContent, i18n: this.i18n })}
                            </div>`,
                    width: "520px",
                    height: "400px",
                    transparent: false,
                    disableClose: false,
                    disableAnimation: false,
                    destroyCallback: () => {
                        const textarea = dialog.element.querySelector('textarea') as HTMLTextAreaElement;
                        if (textarea && textarea.value.trim()) {
                            this.tempNoteContent = textarea.value;
                            this.tempNoteTags = Array.from(dialog.element.querySelectorAll('.tag-item'))
                                .map(tag => tag.getAttribute('data-tag'))
                                .filter(tag => tag !== null) as string[];
                        }
                        this.isCreatingNote = false;
                        resolve(false);
                    }
                });

                // 在对话框创建后立即聚焦到文本框
                setTimeout(() => {
                    const textarea = dialog.element.querySelector('textarea') as HTMLTextAreaElement;
                    if (textarea) {
                        textarea.focus();
                        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

                        textarea.addEventListener('keydown', async (e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                dialog.element.querySelector('[data-type="save"]')?.click();
                            }
                            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                                e.preventDefault();
                                const addTagBtn = dialog.element.querySelector('.add-tag-btn') as HTMLElement;
                                if (addTagBtn) {
                                    addTagBtn.click();
                                }
                            }
                        });
                    }

                    if (this.tempNoteTags.length > 0) {
                        const tagsList = dialog.element.querySelector('.tags-list');
                        if (tagsList) {
                            this.tempNoteTags.forEach(tagText => {
                                const tagElement = document.createElement('span');
                                tagElement.className = 'tag-item b3-chip b3-chip--middle b3-tooltips b3-tooltips__n';
                                tagElement.setAttribute('data-tag', tagText);
                                tagElement.setAttribute('aria-label', tagText);
                                tagElement.style.cursor = 'default';
                                tagElement.innerHTML = `
                                        <span class="b3-chip__content" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tagText}</span>
                                        <svg class="b3-chip__close" style="cursor: pointer;">
                                            <use xlink:href="#iconClose"></use>
                                        </svg>
                                    `;
                                tagsList.appendChild(tagElement);

                                tagElement.querySelector('.b3-chip__close').addEventListener('click', () => {
                                    tagElement.remove();
                                });
                            });
                        }
                    }
                }, 100);

                // 绑定保存按钮事件
                const saveBtn = dialog.element.querySelector('[data-type="save"]');
                const textarea = dialog.element.querySelector('textarea');
                if (saveBtn && textarea) {
                    saveBtn.onclick = async () => {
                        const text = textarea.value;
                        const tags = Array.from(dialog.element.querySelectorAll('.tag-item'))
                            .map(tag => tag.getAttribute('data-tag'));

                        if (text.trim()) {
                            await this.saveContent(text, tags);
                            dialog.destroy();
                            this.tempNoteContent = '';
                            this.tempNoteTags = [];
                            resolve(true);
                            return;
                        }
                        resolve(false);
                    };
                }

                this.setupTagsFeature(dialog.element);

                setTimeout(() => {
                    this.imageService.setupImageUpload({
                        container: dialog.element,
                        i18n: this.i18n
                    });
                }, 100);
            });

        } catch (error) {
            console.error('Error creating new note:', error);
            return false;
        }
    }

    // 编辑历史记录
    private async editHistoryItem(timestamp: number) {
        try {
            const success = await this.historyService.openEditDialog(timestamp,
                {
                    getEditorTemplate: (text) => this.editorService.getEditorTemplate({ text, i18n: this.i18n }),
                    setupTagsFeature: (element) => this.setupTagsFeature(element),
                    setupImageUpload: (element) => this.imageService.setupImageUpload({
                        container: element,
                        i18n: this.i18n
                    })
                },
            );
            if (success) {
                // showMessage(this.i18n.note.editSuccess);
                this.renderDockerToolbar();
                this.renderDockHistory();
            }
        } catch (error) {
            console.error('Error editing history item:', error);
            return false;
        }
    }

    // 保存内容并更新历史记录
    private async saveContent(text: string, tags: string[] = []): Promise<void> {
        const success = await this.historyService.saveContent({ text, tags });

        if (success) {
            // 检查是否需要自动复制到每日笔记
            const autoCopyToDaily = this.settingUtils.get("autoCopyToDaily");
            let defaultNotebook = this.settingUtils.get("defaultNotebook");

            if (autoCopyToDaily) {
                try {
                    // 如果没有设置默认笔记本，获取第一个笔记本
                    if (!defaultNotebook) {
                        const notebooks = await lsNotebooks();
                        if (notebooks && notebooks.notebooks && notebooks.notebooks.length > 0) {
                            defaultNotebook = notebooks.notebooks[0].id;
                        }
                    }

                    if (defaultNotebook) {
                        // 创建或获取每日笔记
                        const result = await createDailyNote(defaultNotebook);

                        // 获取模板并替换变量
                        let template = this.settingUtils.get("insertTemplate") || "> [!note] 小记 ${time}\n${content}${tags}";

                        // 准备变量值
                        const time = new Date().toLocaleString();
                        const content = text;  // 不再添加 > 前缀
                        const tagsVal = tags && tags.length > 0 ? tags.map(tag => `#${tag}`).join(' ') : '';

                        // 替换模板中的变量
                        const content_final = template
                            .replace(/\${time}/g, time)
                            .replace(/\${content}/g, content)
                            .replace(/\${tags}/g, tagsVal);
                        // 插入内容到文档末尾
                        const appendResult = await appendBlock("markdown", content_final, result.id);
                        // appendResult[0] 包含 doOperations 数组，其中第一个操作的 id 就是 blockId
                        // const blockId = appendResult?.[0]?.doOperations?.[0]?.id;
                        // if (blockId) {
                        //     // 在原小记末尾添加引用链接
                        //     const newText = text + `\n\n[${this.i18n.note.referenceLink}](siyuan://blocks/${blockId})`;
                        //     await this.historyService.saveContent({ text: newText, tags });
                        // } else {
                        // 如果没有获取到 blockId，仍然保存原始内容
                        // await this.historyService.saveContent({ text, tags });
                        // }

                        await this.historyService.saveContent({ text, tags });
                    } else {
                        console.warn('没有可用的笔记本');
                    }
                } catch (error) {
                    console.error('自动复制到每日笔记失败:', error);
                    // 这里我们不显示错误消息，因为这是自动操作
                }
            }

            if (this.element) {
                this.initDockPanel();
            }
        }
    }

    // 设置标签功能
    private setupTagsFeature(container: HTMLElement) {
        const tagsList = container.querySelector('.tags-list');
        const addTagBtn = container.querySelector('.add-tag-btn');

        if (tagsList && addTagBtn) {
            addTagBtn.onclick = (e) => {
                e.stopPropagation();


                // 获取所有标签并去重
                const allTags = Array.from(new Set(this.historyService.getCurrentData()
                    ?.filter(item => item && Array.isArray(item.tags))
                    .flatMap(item => item.tags || [])
                ));

                // 创建标签选择面板
                const tagPanel = document.createElement('div');
                tagPanel.className = 'tag-panel';
                tagPanel.style.cssText = `
            position: fixed;
            z-index: 204;
            width: 133px;
            height: 150px; // 固定高度
            background: var(--b3-menu-background);
            border: 1px solid var(--b3-border-color);
            border-radius: var(--b3-border-radius);
            box-shadow: var(--b3-dialog-shadow);
            display: flex;
            flex-direction: column;
            padding: 0;
            overflow: hidden; // 防止内容溢出
        `;

                // 修改位置计算逻辑
                const btnRect = addTagBtn.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const panelHeight = 150; // 面板高度
                const margin = 8; // 边距

                // 判断是否有足够空间在上方显示
                const showAbove = btnRect.top > panelHeight + margin;
                // 如果上方空间不够，就显示在下方
                const top = showAbove ?
                    btnRect.top - panelHeight - margin :
                    btnRect.bottom + margin;

                tagPanel.style.top = `${top}px`;
                tagPanel.style.left = `${btnRect.left}px`;

                // 如果面板会超出视口右侧，则向左对齐
                if (btnRect.left + 133 > window.innerWidth) { // 使用新的宽度
                    tagPanel.style.left = `${btnRect.left + btnRect.width - 133}px`; // 使用新的宽度
                }

                // 修改面板内容结构
                tagPanel.innerHTML = `
            <div style="padding: 8px; border-bottom: 1px solid var(--b3-border-color); background: var(--b3-menu-background); flex-shrink: 0;">
                <input type="text" 
                    class="b3-text-field fn__flex-1 tag-input" 
                    placeholder="${this.i18n.note.addTag}..."
                    style="width: 100%; background: var(--b3-theme-background);">
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--b3-menu-background);">
                <div style="padding: 8px 8px 4px 8px; font-size: 12px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;">
                    ${this.i18n.note.existingTags}
                </div>
                <div class="history-tags" style="padding: 0 8px 8px 8px; overflow-y: auto; flex: 1;">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        ${allTags.length > 0 ?
                        allTags
                            .sort((a, b) => {
                                const countA = this.historyService.getCurrentData()?.filter(item => item.tags?.includes(a)).length;
                                const countB = this.historyService.getCurrentData()?.filter(item => item.tags?.includes(b)).length;
                                return countB - countA;
                            })
                            .map(tag => `
                                    <div class="history-tag b3-chip b3-chip--middle" 
                                        style="cursor: pointer; padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; background: var(--b3-menu-background);" 
                                        data-tag="${tag}">
                                        <span class="b3-chip__content" style="max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                            ${tag}
                                        </span>
                                        <span class="tag-count" style="margin-left: 4px; font-size: 10px; opacity: 0.7; background: var(--b3-theme-surface); padding: 2px 4px; border-radius: 8px;">
                                            ${this.historyService.getCurrentData().filter(item => item.tags?.includes(tag)).length}
                                        </span>
                                    </div>
                                `).join('')
                        : `<div style="color: var(--b3-theme-on-surface-light); font-size: 12px; text-align: center; padding: 8px;">
                        ${this.i18n.note.noTags}
                       </div>`
                    }
                    </div>
                </div>
            </div>
        `;

                // 将面板添加到文档根节点
                document.body.appendChild(tagPanel);

                // 获取输入框元素
                const tagInput = tagPanel.querySelector('.tag-input') as HTMLInputElement;
                tagInput.focus();

                // 添加标签的函数
                const addTag = (tagText: string) => {
                    if (tagText.trim()) {
                        const existingTags = Array.from(tagsList.querySelectorAll('.tag-item'))
                            .map(tag => tag.getAttribute('data-tag'));

                        if (!existingTags.includes(tagText)) {
                            const tagElement = document.createElement('span');
                            tagElement.className = 'tag-item b3-chip b3-chip--middle b3-tooltips b3-tooltips__n';
                            tagElement.setAttribute('data-tag', tagText);
                            tagElement.setAttribute('aria-label', tagText);
                            tagElement.style.cursor = 'default';
                            tagElement.innerHTML = `
                        <span class="b3-chip__content" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tagText}</span>
                        <svg class="b3-chip__close" style="cursor: pointer;">
                            <use xlink:href="#iconClose"></use>
                        </svg>
                    `;
                            tagsList.appendChild(tagElement);

                            // 添加删除标签的事件
                            tagElement.querySelector('.b3-chip__close').addEventListener('click', () => {
                                tagElement.remove();
                            });
                        }
                        tagInput.value = '';
                        // 添加标签后关闭面板
                        tagPanel.remove();
                        document.removeEventListener('click', closePanel);
                    }
                };

                // 回车添加标签
                tagInput.addEventListener('keydown', (e) => {
                    const historyTags = Array.from(tagPanel.querySelectorAll('.history-tag:not([style*="display: none"])'));
                    const currentSelected = tagPanel.querySelector('.history-tag.selected');
                    let currentIndex = currentSelected ? historyTags.indexOf(currentSelected) : -1;

                    switch (e.key) {
                        case 'ArrowDown':
                            e.preventDefault();
                            if (historyTags.length > 0) {
                                // 移除当前选中项的样式
                                if (currentSelected) {
                                    currentSelected.classList.remove('selected');
                                    currentSelected.style.backgroundColor = '';
                                }
                                // 计算下一个索引
                                currentIndex = currentIndex < historyTags.length - 1 ? currentIndex + 1 : 0;
                                // 添加新选中项的样式
                                const nextTag = historyTags[currentIndex] as HTMLElement;
                                nextTag.classList.add('selected');
                                nextTag.style.backgroundColor = 'var(--b3-theme-primary-light)';
                                // 确保选中项可见
                                nextTag.scrollIntoView({ block: 'nearest' });
                            }
                            break;

                        case 'ArrowUp':
                            e.preventDefault();
                            if (historyTags.length > 0) {
                                // 移除当前选中项的样式
                                if (currentSelected) {
                                    currentSelected.classList.remove('selected');
                                    currentSelected.style.backgroundColor = '';
                                }
                                // 计算上一个索引
                                currentIndex = currentIndex > 0 ? currentIndex - 1 : historyTags.length - 1;
                                // 添加新选中项的样式
                                const prevTag = historyTags[currentIndex] as HTMLElement;
                                prevTag.classList.add('selected');
                                prevTag.style.backgroundColor = 'var(--b3-theme-primary-light)';
                                // 确保选中项可见
                                prevTag.scrollIntoView({ block: 'nearest' });
                            }
                            break;

                        case 'Enter':
                            e.preventDefault();
                            const searchText = tagInput.value.trim();
                            if (currentSelected) {
                                // 如果有选中的标签，使用该标签
                                addTag(currentSelected.getAttribute('data-tag'));
                                const textarea = container.querySelector('textarea');
                                if (textarea) {
                                    textarea.focus();
                                }
                            } else if (searchText) {
                                // 如果没有选中的标签但有输入文本，检查是否有匹配的标签
                                const matchingTag = Array.from(tagPanel.querySelectorAll('.history-tag'))
                                    .find(tag => tag.getAttribute('data-tag').toLowerCase() === searchText.toLowerCase());

                                if (matchingTag) {
                                    // 如果有完全匹配的标签，使用该标签
                                    addTag(matchingTag.getAttribute('data-tag'));
                                } else {
                                    // 如果没有匹配的标签，创建新标签
                                    addTag(searchText);
                                }

                                const textarea = container.querySelector('textarea');
                                if (textarea) {
                                    textarea.focus();
                                }
                            }
                            break;
                    }
                });

                // 修改鼠标悬停事件处理，避免与键盘选择冲突
                tagPanel.querySelectorAll('.history-tag').forEach(tag => {
                    tag.addEventListener('mouseenter', () => {
                        if (!tag.classList.contains('selected')) {
                            tag.style.backgroundColor = 'var(--b3-theme-primary-light)';
                        }
                    });

                    tag.addEventListener('mouseleave', () => {
                        if (!tag.classList.contains('selected')) {
                            tag.style.backgroundColor = '';
                        }
                    });
                });

                // 点击其他地方关闭面板
                const closePanel = (e: MouseEvent) => {
                    if (!tagPanel.contains(e.target as Node) && !addTagBtn.contains(e.target as Node)) {
                        tagPanel.remove();
                        document.removeEventListener('click', closePanel);
                    }
                    const textarea = container.querySelector('textarea');
                    if (textarea) {
                        // 将焦点设置到编辑框上
                        textarea.focus();
                    }
                };

                // 延迟添加点击事件，避免立即触发
                setTimeout(() => {
                    document.addEventListener('click', closePanel);
                }, 0);

                // 添加标签点击事件
                tagPanel.querySelectorAll('.history-tag').forEach(tag => {
                    tag.addEventListener('click', () => {
                        const tagText = tag.getAttribute('data-tag');
                        if (tagText) {
                            addTag(tagText);
                        }
                    });

                    // 添加悬停效果
                    tag.addEventListener('mouseenter', () => {
                        tag.style.backgroundColor = 'var(--b3-theme-primary-light)';
                    });
                    tag.addEventListener('mouseleave', () => {
                        tag.style.backgroundColor = '';
                    });
                });

                // 添加搜索功能
                tagInput.addEventListener('input', (e) => {
                    const searchText = (e.target as HTMLInputElement).value.toLowerCase();
                    const historyTags = tagPanel.querySelectorAll('.history-tag');

                    historyTags.forEach(tag => {
                        const tagText = tag.getAttribute('data-tag').toLowerCase();
                        if (tagText.includes(searchText)) {
                            (tag as HTMLElement).style.display = 'flex';
                        } else {
                            (tag as HTMLElement).style.display = 'none';
                        }
                    });

                    // 如果没有匹配的标签，显示"无匹配标签"提示
                    const visibleTags = Array.from(historyTags).filter(tag =>
                        (tag as HTMLElement).style.display !== 'none'
                    );

                    const noMatchMessage = tagPanel.querySelector('.no-match-message');
                    if (visibleTags.length === 0 && searchText) {
                        if (!noMatchMessage) {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'no-match-message';
                            messageDiv.style.cssText = 'color: var(--b3-theme-on-surface-light); font-size: 12px; text-align: center; padding: 8px;';
                            messageDiv.textContent = this.i18n.note.noMatchingTags;
                            tagPanel.querySelector('.history-tags').appendChild(messageDiv);
                        }
                    } else if (noMatchMessage) {
                        noMatchMessage.remove();
                    }
                });

                // 修改回车键处理逻辑
                tagInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const searchText = tagInput.value.trim();
                        if (searchText) {
                            // 检查是否有匹配的已有标签
                            const matchingTag = Array.from(tagPanel.querySelectorAll('.history-tag'))
                                .find(tag => tag.getAttribute('data-tag').toLowerCase() === searchText.toLowerCase());

                            if (matchingTag) {
                                // 如果有完全匹配的标签，直接使用该标签
                                addTag(matchingTag.getAttribute('data-tag'));
                            } else {
                                // 如果没有完全匹配的标签，创建新标签
                                addTag(searchText);
                            }

                            const textarea = container.querySelector('textarea');
                            if (textarea) {
                                textarea.focus();
                            }
                        }
                    }
                });
            };
        }
    }


    // 设置搜索功能
    private setupSearchFeature(container: HTMLElement) {
        const searchBtn = container.querySelector('.search-btn');
        const searchInput = container.querySelector('.search-input') as HTMLInputElement;
        const searchWrapper = container.querySelector('.search-wrapper');

        if (searchBtn && searchInput && searchWrapper) {
            searchBtn.onclick = () => {
                searchInput.style.width = '200px';
                searchInput.style.opacity = '1';
                searchBtn.style.display = 'none';
                searchInput.focus();
            };

            searchInput.onblur = () => {
                if (!searchInput.value) {
                    searchInput.style.width = '0';
                    searchInput.style.opacity = '0';
                    setTimeout(() => {
                        searchBtn.style.display = 'block';
                    }, 300);
                }
            };

            searchInput.oninput = () => {
                const searchText = searchInput.value.toLowerCase();

                if (!searchText) {
                    this.currentDisplayCount = this.itemsPerPage;
                    this.renderDockHistory();
                    return;
                }
                // 在选定的数据源中搜索
                const filteredHistory = this.historyService.searchHistory(searchText);

                // 只更新历史记录内容部分
                const historyContent = container.querySelector('.history-content');
                if (historyContent) {
                    const pinnedHistory = filteredHistory.filter(item => item.isPinned);
                    const unpinnedHistory = filteredHistory.filter(item => !item.isPinned);

                    historyContent.innerHTML = `
                        ${this.showArchived ? `
                            <div class="fn__flex-center" style="padding: 8px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface); font-size: 12px;">
                                <svg class="b3-button__icon" style="height: 14px; width: 14px; margin-right: 4px;">
                                    <use xlink:href="#iconArchive"></use>
                                </svg>
                                ${this.i18n.note.archivedView}
                            </div>
                        ` : ''}
                        ${pinnedHistory.length > 0 ? this.renderPinnedHistory(pinnedHistory) : ''}
                        ${this.renderUnpinnedHistory(unpinnedHistory, pinnedHistory.length > 0)}
                        ${filteredHistory.length === 0 ? `
                            <div class="fn__flex-center" style="padding: 16px 0; color: var(--b3-theme-on-surface-light); font-size: 12px;">
                                ${this.i18n.note.noSearchResults}
                            </div>
                        ` : ''}
                    `;

                    // 高亮匹配文本
                    historyContent.querySelectorAll('.text-content').forEach(content => {
                        const text = content.getAttribute('data-text');
                        if (text) {
                            const displayText = content.querySelector('[style*="color: var(--b3-theme-on-surface)"]');
                            if (displayText) {
                                const highlightedText = text.replace(
                                    new RegExp(searchText, 'gi'),
                                    match => `<span style="background-color: var(--b3-theme-primary-light);">${match}</span>`
                                );
                                displayText.innerHTML = highlightedText;
                            }
                        }
                    });

                    // 重新绑定事件
                    this.bindHistoryListEvents();
                }
            };

            searchInput.onkeydown = (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    searchInput.dispatchEvent(new Event('input'));
                    searchInput.blur();
                }
            };
        }
    }

    // 设置排序功能
    private setupSortFeature(container: HTMLElement) {
        const sortBtn = container.querySelector('.sort-btn');
        if (sortBtn) {
            const sortIcon = sortBtn.querySelector('svg');
            if (sortIcon) {
                sortIcon.style.transform = this.isDescending ? 'rotate(0deg)' : 'rotate(180deg)';
                sortIcon.style.transition = 'transform 0.3s ease';
            }

            sortBtn.onclick = () => {
                this.isDescending = !this.isDescending;
                this.historyService.setIsDescending(this.isDescending);
                // 更新图标旋转状态
                if (sortIcon) {
                    sortIcon.style.transform = this.isDescending ? 'rotate(0deg)' : 'rotate(180deg)';
                }

                this.initDockPanel();
            };
        }
    }

    // 设置标签过滤功能
    private setupFilterFeature(container: HTMLElement) {
        const filterBtn = container.querySelector('.filter-btn');
        const filterPanel = container.querySelector('.filter-panel');
        if (filterBtn && filterPanel) {
            let isFilterPanelOpen = false;

            filterBtn.onclick = () => {
                isFilterPanelOpen = !isFilterPanelOpen;
                filterPanel.style.display = isFilterPanelOpen ? 'block' : 'none';
                filterBtn.style.color = isFilterPanelOpen ? 'var(--b3-theme-primary)' : '';
            };

            // 获取所有标签及其使用次数
            const tagUsage = this.historyService.getCurrentData()
                .flatMap(item => item.tags || [])
                .reduce((acc, tag) => {
                    acc[tag] = (acc[tag] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);

            // 按使用次数排序标签
            const sortedTags = Object.entries(tagUsage)
                .sort((a, b) => b[1] - a[1])
                .map(([tag]) => tag);

            // 显示前几个常用标签
            const commonTags = sortedTags.slice(0, 6);
            const otherTags = sortedTags.slice(6);

            // 渲染常用标签
            let tagsHtml = `<div class="tags-container" style="display: flex; flex-wrap: wrap; gap: 8px;">`;
            tagsHtml += commonTags.map(tag => `
                <span class="b3-chip b3-chip--middle filter-tag b3-tooltips b3-tooltips__n" 
                    style="cursor: pointer; 
                        background-color: var(--b3-theme-surface);
                        color: var(--b3-theme-on-surface);
                        border: 1px solid var(--b3-border-color);
                        transition: all 0.2s ease;" 
                    data-tag="${tag}"
                    aria-label="${tag}"
                    data-selected="false">
                    <span class="b3-chip__content" style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tag}</span>
                    <span class="tag-count" style="margin-left: 4px; font-size: 10px; opacity: 0.7;">
                        ${tagUsage[tag]}
                    </span>
                </span>
            `).join('');

            // 添加折叠按钮
            if (otherTags.length > 0) {
                tagsHtml += `
                    <div class="other-tags" style="display: none;">
                        ${otherTags.map(tag => `
                            <span class="b3-chip b3-chip--middle filter-tag b3-tooltips b3-tooltips__n" 
                                style="cursor: pointer; 
                                    background-color: var(--b3-theme-surface);
                                    color: var(--b3-theme-on-surface);
                                    border: 1px solid var(--b3-border-color);
                                    transition: all 0.2s ease;" 
                                data-tag="${tag}"
                                aria-label="${tag}"
                                data-selected="false">
                                <span class="b3-chip__content" style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tag}</span>
                                <span class="tag-count" style="margin-left: 4px; font-size: 10px; opacity: 0.7;">
                                    ${tagUsage[tag]}
                                </span>
                            </span>
                        `).join('')}
                    </div>
                    <button class="b3-button b3-button--text toggle-tags" 
                        style="padding: 0 4px; font-size: 12px; color: var(--b3-theme-primary); display: inline-flex; align-items: center;">
                        ${this.i18n.note.expandTags}
                        <svg class="b3-button__icon" style="height: 12px; width: 12px; margin-left: 2px; transition: transform 0.2s ease;">
                            <use xlink:href="#iconDown"></use>
                        </svg>
                    </button>
                `;
            }
            tagsHtml += `</div>`;

            filterPanel.innerHTML = tagsHtml;

            // 绑定折叠按钮事件
            const toggleTagsBtn = filterPanel.querySelector('.toggle-tags');
            const otherTagsDiv = filterPanel.querySelector('.other-tags');
            if (toggleTagsBtn && otherTagsDiv) {
                toggleTagsBtn.onclick = () => {
                    const isVisible = otherTagsDiv.style.display !== 'none';
                    otherTagsDiv.style.display = isVisible ? 'none' : 'block';
                    toggleTagsBtn.innerHTML = isVisible ? `${this.i18n.note.expandTags}
                        <svg class="b3-button__icon" style="height: 12px; width: 12px; margin-left: 2px; transform: rotate(0deg); transition: transform 0.2s ease;">
                            <use xlink:href="#iconDown"></use>
                        </svg>` : `${this.i18n.note.collapseTags}
                        <svg class="b3-button__icon" style="height: 12px; width: 12px; margin-left: 2px; transform: rotate(180deg); transition: transform 0.2s ease;">
                            <use xlink:href="#iconDown"></use>
                        </svg>`;
                };
            }

            // 绑定标签点击事件
            const filterTags = filterPanel.querySelectorAll('.filter-tag');
            filterTags.forEach(tag => {
                tag.addEventListener('click', () => {
                    const isSelected = tag.getAttribute('data-selected') === 'true';
                    tag.setAttribute('data-selected', (!isSelected).toString());
                    if (!isSelected) {
                        tag.style.backgroundColor = 'var(--b3-theme-primary)';
                        tag.style.color = 'var(--b3-theme-on-primary)';
                        tag.style.border = '1px solid var(--b3-theme-primary)';
                    } else {
                        tag.style.backgroundColor = 'var(--b3-theme-surface)';
                        tag.style.color = 'var(--b3-theme-on-surface)';
                        tag.style.border = '1px solid var(--b3-border-color)';
                    }

                    this.selectedTags = Array.from(filterPanel.querySelectorAll('.filter-tag[data-selected="true"]'))
                        .map(tag => tag.getAttribute('data-tag'));

                    this.currentDisplayCount = this.itemsPerPage;

                    const filterPanelDisplay = filterPanel.style.display;
                    const filterBtnColor = filterBtn.style.color;


                    const newFilterPanel = container.querySelector('.filter-panel');
                    const newFilterBtn = container.querySelector('.filter-btn');
                    if (newFilterPanel && newFilterBtn) {
                        newFilterPanel.style.display = filterPanelDisplay;
                        newFilterBtn.style.color = filterBtnColor;
                    }
                    this.historyService.updateSelectedTags(this.selectedTags);
                    this.updateFilterTagIndicator();
                    this.renderDockHistory();
                });
            });
        }
    }

    //更新标签图标的小圆点状态
    private updateFilterTagIndicator() {
        let container = this.element;
        // 更新过滤按钮状态指示器
        const filterBtn = container.querySelector('.filter-btn');
        if (filterBtn) {
            // 添加或移除过滤状态指示点
            const indicator = filterBtn.querySelector('.filter-indicator');
            if (this.selectedTags.length > 0) {
                if (!indicator) {
                    const dot = document.createElement('div');
                    dot.className = 'filter-indicator';
                    dot.style.cssText = `
                                            position: absolute;
                                            top: 0;
                                            right: 0;
                                            width: 6px;
                                            height: 6px;
                                            border-radius: 50%;
                                            background-color: var(--b3-theme-primary);
                                        `;
                    filterBtn.appendChild(dot);
                }
            } else {
                indicator?.remove();
            }
        }
    }
    // 设置导出功能
    private setupExportFeature(container: HTMLElement) {
        const exportBtn = container.querySelector('[data-type="export"]'); // 修改选择器以匹配顶部栏的导出按钮
        if (exportBtn) {
            this.exportDialog = new ExportDialog(this.i18n);
            this.exportService = new ExportService(this.i18n);
            exportBtn.addEventListener('click', () => {
                // 创建导出对话框
                this.exportDialog.show(
                    {
                        history: this.historyService.getHistoryData(),
                        archivedHistory: this.historyService.getArchivedData()
                    },
                    this.historyService.getHistoryData(),
                    (filteredData, format) => {
                        // 导出回调
                        const success = this.exportService.exportData(filteredData, format);
                        if (success) {
                            showMessage(this.i18n.note.exportSuccess);
                        } else {
                            showMessage(this.i18n.note.exportFailed);
                        }
                    }
                );
            });
        }
    }

    private cleanupEventListeners() {
        const historyList = this.element?.querySelector('.history-list');
        if (historyList && this.historyClickHandler) {
            historyList.removeEventListener('click', this.historyClickHandler);
        }
    }

    private async createNoteAsDocument(timestamp: number) {
        const note = this.historyService.getHistoryItem(timestamp);
        await this.documentService.createNoteAsDocument(timestamp, note);
    }

    private async insertToDaily(timestamp: number) {
        const note = this.historyService.getHistoryItem(timestamp);
        const insertMode = this.settingUtils.get("insertMode");
        if (insertMode === "doc") {
            await this.documentService.insertToDocument(timestamp, note);
        } else {
            await this.documentService.insertToDaily(timestamp, note);
        }
    }

    private async generateShareImage(timestamp: number) {
        await this.shareService.generateShareImage(timestamp);
    }

    private createQuickInputWindow() {
        const quickInputWindow = QuickInputWindow.getInstance(this);
        quickInputWindow.createWindow();
    }

    async upload(file: File): Promise<string> {
        // 实现文件上传逻辑
        return Promise.resolve('');
    }

    private getInsertButtonInfo() {
        const insertMode = this.settingUtils.get("insertMode");
        return {
            label: insertMode === "doc" ? this.i18n.note.insertToDoc : this.i18n.note.insertToDaily,
            icon: insertMode === "doc" ? "iconInsertDoc" : "iconCalendar"
        };
    }

    private openCardView() {
        const id = Math.random().toString(36).substring(7);
        const historyService = this.historyService; // 保存引用
        this.addTab({
            type: id,
            init: function(this: any) {
                const cardView = new CardView(historyService);
                this.element.appendChild(cardView.getElement());
            },
            destroy: () => {
                // 清理工作
            }
        });

        openTab({
            app: this.app,
            custom: {
                icon: "iconLayout",
                title: this.i18n.note.cardView,
                id: this.name + id,
            }
        });
    }
}
