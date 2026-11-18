//! Real desktop/menu integration. Compiled only into the Rust test executable.
use crate::{
    browser::{self, BrowserState},
    native_webview_test::{mouse, script, wait_script},
};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{Manager, Webview};
use webview2_com::{
    take_pwstr, ContextMenuRequestedEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ContextMenuRequestedEventArgs, ICoreWebView2Deferral, ICoreWebView2_11,
    },
};
use windows_core::{Interface, PWSTR};

thread_local! {static HELD: std::cell::RefCell<Option<(ICoreWebView2ContextMenuRequestedEventArgs, ICoreWebView2Deferral,i32)>>=const{std::cell::RefCell::new(None)};}
const TOP_SELECTION:&str="(()=>{const e=document.getElementById('quote');document.activeElement.blur();getSelection().selectAllChildren(e);const b=getSelection().getRangeAt(0).getBoundingClientRect();return [b.x+10,b.y+b.height/2]})()";

// Let WebView2 invoke the same custom command as a user click. All pointer input is scoped
// to this test's WebView2 controller; nothing is sent to the user's desktop or clipboard.
async fn choose_native_menu(
    view: &Webview,
    hold: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<tokio::sync::mpsc::UnboundedReceiver<bool>, String> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let (installed, ready) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| unsafe {
        let result = (|| {
            let menus = native
                .controller()
                .CoreWebView2()?
                .cast::<ICoreWebView2_11>()?;
            menus.add_ContextMenuRequested(
                &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let items = args.MenuItems()?;
                    let mut count = 0;
                    items.Count(&mut count)?;
                    let mut found = false;
                    for i in 0..count {
                        let item = items.GetValueAtIndex(i)?;
                        let mut label = PWSTR::null();
                        item.Label(&mut label)?;
                        if take_pwstr(label) == browser::reference::MENU_LABEL {
                            let mut id = 0;
                            item.CommandId(&mut id)?;
                            if hold.swap(false, std::sync::atomic::Ordering::AcqRel) {
                                let deferral = args.GetDeferral()?;
                                HELD.with(|slot| {
                                    *slot.borrow_mut() = Some((args.clone(), deferral, id))
                                });
                            } else {
                                args.SetSelectedCommandId(id)?;
                            }
                            found = true;
                            break;
                        }
                    }
                    args.SetHandled(true)?;
                    let _ = tx.send(found);
                    Ok(())
                })),
                &mut 0,
            )
        })();
        let _ = installed.send(result.map_err(|e| e.to_string()));
    })
    .map_err(|e| e.to_string())?;
    ready.await.map_err(|e| e.to_string())??;
    Ok(rx)
}
async fn right_click(view: &Webview, expression: &str) -> Result<(), String> {
    let xy = script(view.clone(), expression).await?;
    let x = xy[0].as_f64().ok_or("missing x")?;
    let y = xy[1].as_f64().ok_or("missing y")?;
    mouse(view, "mousePressed", "right", x, y).await?;
    mouse(view, "mouseReleased", "right", x, y).await
}
async fn menu(rx: &mut tokio::sync::mpsc::UnboundedReceiver<bool>) -> Result<bool, String> {
    tokio::time::timeout(Duration::from_secs(6), rx.recv())
        .await
        .map_err(|_| "native context menu event did not arrive")?
        .ok_or("menu closed".into())
}
async fn check(app: &tauri::AppHandle, origin: &str) -> Result<(), String> {
    let folder = tempfile::tempdir().map_err(|e| e.to_string())?;
    let root = folder.path().to_str().ok_or("fixture path")?;
    std::fs::write(folder.path().join("unselected.md"), "PRIVATE_LOCAL_FILE")
        .map_err(|e| e.to_string())?;
    let main = app.get_webview("main").ok_or("missing main view")?;
    wait_script(
        &main,
        "!!(typeof workspaceSessionReady!=='undefined' && workspaceSessionReady && !state.loading)",
        true.into(),
    )
    .await?;
    let setup=format!("(async()=>{{aiProjectRoot='';await navigate({});openAiAssistant();aiSettings={{endpoint:{},model:'deepseek-v4-pro',apiFormat:'anthropic-messages'}};aiSessionKey='test-only';await newBrowserTab({});await syncBrowserBounds();window.quoteReady=true;}})().catch(e=>window.quoteReady=String(e))",json!(root),json!(format!("{origin}/v1")),json!(format!("{origin}/x?private=QUERY_SECRET#FRAGMENT_SECRET")));
    main.eval(format!("invoke('harness_engine_set',{{enabled:true}}).then(()=>{{{setup}}}).catch(e=>window.quoteReady=String(e))")).map_err(|e| e.to_string())?;
    wait_script(&main, "window.quoteReady", true.into()).await?;
    let key = script(main.clone(), "curTab().key")
        .await?
        .as_str()
        .ok_or("browser key")?
        .to_owned();
    let child = app
        .state::<BrowserState>()
        .0
        .lock()
        .map_err(|_| "browser map")?
        .get(&key)
        .cloned()
        .ok_or("missing browser child")?;
    wait_script(&child, "!!document.getElementById('quote')", true.into()).await?;
    let hold = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mut choices = choose_native_menu(&child, hold.clone()).await?;
    if script(
        child.clone(),
        "window.top===window && window.frames.length===0",
    )
    .await?
        != true
    {
        return Err("test did not open an unframed top-level document".into());
    }
    child.eval("Promise.resolve().then(()=>window.__TAURI__.core.invoke('harness_list',{root:null})).then(()=>window.permissionCheck='granted',()=>window.permissionCheck='denied')").map_err(|e|e.to_string())?;
    wait_script(&child, "window.permissionCheck", json!("denied")).await?;
    right_click(&child,"(()=>{const e=document.querySelector('input');e.focus();e.select();const b=e.getBoundingClientRect();return [b.x+12,b.y+b.height/2]})()").await?;
    if menu(&mut choices).await? {
        return Err("editable selection was offered".into());
    }
    child.eval("(()=>{const f=document.createElement('iframe');f.id='sameUrl';f.src=location.href;document.body.append(f);})()").map_err(|e|e.to_string())?;
    wait_script(
        &child,
        "!!document.querySelector('iframe')?.contentDocument?.querySelector('#quote')",
        true.into(),
    )
    .await?;
    right_click(&child,"(()=>{const f=document.querySelector('iframe'),w=f.contentWindow,e=w.document.getElementById('quote');w.getSelection().selectAllChildren(e);const b=e.getBoundingClientRect(),p=f.getBoundingClientRect();return [p.x+f.clientLeft+b.x+9,p.y+f.clientTop+b.y+b.height/2]})()").await?;
    if menu(&mut choices).await? {
        return Err("same-URL iframe was offered as the main document".into());
    }
    child
        .eval("document.querySelector('iframe').remove()")
        .map_err(|e| e.to_string())?;
    main.eval("window.observedQuotes=0;{const open=openWebQuote;openWebQuote=id=>{window.observedQuotes++;window.testQuote=id;return open(id);};}").map_err(|e|e.to_string())?;
    hold.store(true, std::sync::atomic::Ordering::Release);
    let copy = child.clone();
    let press = tauri::async_runtime::spawn(async move { right_click(&copy, TOP_SELECTION).await });
    if !menu(&mut choices).await? {
        return Err("no command in delayed menu".into());
    }
    browser::browser_navigate(app.state(), key.clone(), format!("{origin}/y"))?;
    let (sent, done) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = HELD
            .with(|slot| slot.borrow_mut().take())
            .ok_or("no deferred menu")
            .and_then(|(args, def, id)| unsafe {
                let _ = args.SetSelectedCommandId(id);
                def.Complete()
                    .map_err(|_| "could not release deferred menu")
            });
        let _ = sent.send(result);
    })
    .map_err(|e| e.to_string())?;
    done.await.map_err(|e| e.to_string())??;
    press.await.map_err(|e| e.to_string())??;
    wait_script(&child, "document.title", json!("page-y")).await?;
    browser::browser_navigate(
        app.state(),
        key.clone(),
        format!("{origin}/x?private=QUERY_SECRET#FRAGMENT_SECRET"),
    )?;
    wait_script(&child, "document.title", json!("page-x")).await?;
    right_click(&child, TOP_SELECTION).await?;
    if !menu(&mut choices).await? {
        return Err("no native quote command for selected page text".into());
    }
    wait_script(
        &main,
        "document.querySelector('#webQuoteDialog [data-quote]')?.textContent",
        json!("SELECTED_FROM_X"),
    )
    .await?;
    if script(main.clone(), "window.observedQuotes").await? != 1 {
        return Err("a stale navigation emitted a second quote".into());
    }
    let url = script(
        main.clone(),
        "document.querySelector('#webQuoteDialog [data-source]').textContent",
    )
    .await?;
    if url != format!("{origin}/x") {
        return Err(format!("incorrect displayed source: {url}"));
    }
    // Clear the capture after binding it to a project, then select fresh text for the normal turn.
    let purge = format!(
        r#"(async()=>{{const root={},id=window.testQuote;
        await invoke('harness_prepare_web',{{id,root,...aiSettings}});
        const expected=await invoke('harness_plan_cleanup',{{root}});
        if(expected.previews!==1)throw Error('expected one bound quote');
        await invoke('harness_clear_workspace',{{root,expected}});
        try{{await invoke('harness_quote_preview',{{id}});throw Error('quote still readable')}}
        catch(e){{if(!String(e).includes('已关闭'))throw e;}}
        document.querySelector('#webQuoteDialog [data-close]').click();window.captureCleared=true;
    }})().catch(e=>window.captureCleared=String(e))"#,
        json!(root)
    );
    main.eval(purge).map_err(|e| e.to_string())?;
    wait_script(
        &main,
        "window.captureCleared && !document.querySelector('#webQuoteDialog')",
        true.into(),
    )
    .await?;
    right_click(&child, TOP_SELECTION).await?;
    if !menu(&mut choices).await? {
        return Err("fresh web capture missing after cleanup".into());
    }
    wait_script(
        &main,
        "document.querySelector('#webQuoteDialog [data-quote]')?.textContent",
        json!("SELECTED_FROM_X"),
    )
    .await?;
    child
        .navigate(format!("{origin}/y").parse().map_err(|_| "fixture URL")?)
        .map_err(|e| e.to_string())?;
    wait_script(&child, "document.title", json!("page-y")).await?;
    main.eval("closeTab(state.tab)")
        .map_err(|e| e.to_string())?;
    let choose=format!("(()=>{{const d=document.querySelector('#webQuoteDialog'),s=d.querySelector('select');s.value={};s.onchange();d.querySelector('[data-preview]').click();}})()",json!(root));
    main.eval(choose).map_err(|e| e.to_string())?;
    wait_script(
        &main,
        "document.querySelector('#webQuoteDialog form')?.hidden",
        false.into(),
    )
    .await?;
    // A local selection finishes after the web preview. Closing it must leave the quote intact.
    let options = json!({"root":root,"sourceRoot":root,"files":["unselected.md"],
        "endpoint":format!("{origin}/v1"),"model":"deepseek-v4-pro","apiFormat":"anthropic-messages"});
    main.eval(format!("invoke('harness_prepare',{options}).then(d=>invoke('harness_discard_preview',{{id:d.id}})).then(()=>window.localPreviewClosed=true)")).map_err(|e|e.to_string())?;
    wait_script(&main, "window.localPreviewClosed", true.into()).await?;
    main.eval("(()=>{const f=document.querySelector('#webQuoteDialog form');f.elements.question.value='Explain the selected text';f.requestSubmit();})()").map_err(|e|e.to_string())?;
    let list = format!(
        "invoke('harness_list',{{root:{}}}).then(rows=>window.quoteResult=rows[0]||null)",
        json!(root)
    );
    for _ in 0..100 {
        main.eval(&list).map_err(|e| e.to_string())?;
        tokio::time::sleep(Duration::from_millis(100)).await;
        let row = script(main.clone(), "window.quoteResult").await?;
        if row["status"] == "succeeded" {
            if row["webSource"]["url"] != format!("{origin}/x")
                || row["result"] != "ANSWER_FOR_X"
                || row["files"] != json!([])
                || row["unread"] != true
            {
                return Err("wrong durable quote result".into());
            }
            main.eval("document.querySelector('#webQuoteDialog [data-close]').click(); openHarnessTasks(); document.querySelector('#harnessTasksDialog [data-all]').click();")
                .map_err(|e| e.to_string())?;
            wait_script(
                &main,
                "document.querySelector('#harnessTasksDialog details[data-id] summary .harness-history-owner')?.textContent",
                row["workspace"]["path"].clone(),
            )
            .await?;
            return Ok(());
        }
        if row["status"] == "failed" {
            return Err(format!("task failed: {}", row["result"]));
        }
    }
    Err(format!(
        "no completed quote: {}",
        script(
            main.clone(),
            "document.querySelector('#webQuoteDialog footer')?.textContent"
        )
        .await
        .unwrap_or(Value::Null)
    ))
}

#[test]
#[ignore = "run tools/harness_m3.cjs with WebView2 and the isolated loopback server"]
fn native_web_quote() {
    let origin = std::env::var("DALIZI_QUOTE_FIXTURE_ORIGIN").expect("run via harness_m3.cjs");
    let url = url::Url::parse(&origin).unwrap();
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.scheme(), "http");
    let mut context = tauri::generate_context!();
    let fixture_id =
        uuid::Uuid::parse_str(&std::env::var("DALIZI_QUOTE_FIXTURE_ID").expect("fixture ID"))
            .expect("valid UUID");
    context.config_mut().identifier = format!("com.dalizi.web-quote-test-{fixture_id}");
    let app = crate::desktop_builder()
        .any_thread()
        .build(context)
        .expect("test desktop");
    let code = app.run_return(move |app, event| {
        if matches!(event, tauri::RunEvent::Ready) {
            let app = app.clone();
            let origin = origin.clone();
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(75), check(&app, &origin))
                    .await
                    .unwrap_or_else(|_| Err("fixture timeout".into()));
                if let Err(e) = &result {
                    eprintln!("native quote test: {e}");
                }
                browser::shutdown(&app.state());
                app.exit(if result.is_ok() { 0 } else { 1 });
            });
        }
    });
    assert_eq!(code, 0, "native quote test failed");
}
