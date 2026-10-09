import UIKit
import WebKit

/// What a launch for screenshots does with the issue's body once it shows,
/// as a finger would (`VERDANDI_BODY_SCROLL`, `VERDANDI_BODY_TAP`): it
/// scrolls the page, then taps what the body shows, so that a state such
/// as the image viewer or an opened `<details>` can be photographed.
struct BodyLaunch {
    /// A CSS selector of what to scroll to the top of the page, a number
    /// of points to scroll the page to, or `sweep`: a screen down every
    /// second to the end of the page, and back up.
    var scroll: String?
    /// CSS selectors of what to tap, a second apart, separated by `|`.
    var tap: String?

    /// Whether a body did it already: only the first does, not the issue
    /// a tap opened.
    static var performed = false

    init?(scroll: String?, tap: String?) {
        guard scroll != nil || tap != nil, !Self.performed else { return nil }
        self.scroll = scroll
        self.tap = tap
    }
}

extension BodyWebView.Coordinator {
    /// Does what the launch asks, once the body has laid out.
    func perform(_ launch: BodyLaunch) {
        guard !BodyLaunch.performed else { return }
        BodyLaunch.performed = true
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            if let scroll = launch.scroll { await self?.scroll(launch: scroll) }
            for selector in (launch.tap ?? "").split(separator: "|") {
                try? await Task.sleep(for: .seconds(1))
                // What loads first, such as an image from elsewhere, is
                // waited for.
                _ = try? await self?.view?.callAsyncJavaScript(
                    """
                    for (let tries = 0; tries < 40; tries++) {
                      const target = document.querySelector(selector);
                      if (target) { target.click(); return true; }
                      await new Promise((resolve) => setTimeout(resolve, 500));
                    }
                    return false;
                    """,
                    arguments: ["selector": String(selector)], contentWorld: BodyDocument.world)
            }
        }
    }

    private func scroll(launch value: String) async {
        guard let scrollView = view?.enclosingScrollView else { return }
        if value == "sweep" {
            await sweep(scrollView)
        } else if let offset = Double(value) {
            scrollView.setContentOffset(CGPoint(x: 0, y: offset), animated: true)
        } else if let top = try? await view?.callAsyncJavaScript(
            "const target = document.querySelector(selector); return target ? target.getBoundingClientRect().top + window.scrollY : null",
            arguments: ["selector": value], contentWorld: BodyDocument.world) as? Double
        {
            scroll(to: CGFloat(top))
        }
    }

    /// Scrolls the page down a screen at a time to its end, and back up, as
    /// someone reading through dozens of comments would.
    private func sweep(_ scrollView: UIScrollView) async {
        func bottom() -> CGFloat {
            max(0, scrollView.contentSize.height + scrollView.adjustedContentInset.bottom - scrollView.bounds.height)
        }
        let step = scrollView.bounds.height * 0.8
        while scrollView.contentOffset.y < bottom() - 1 {
            scrollView.setContentOffset(CGPoint(x: 0, y: min(bottom(), scrollView.contentOffset.y + step)), animated: true)
            try? await Task.sleep(for: .seconds(1))
        }
        try? await Task.sleep(for: .seconds(3))
        while scrollView.contentOffset.y > -scrollView.adjustedContentInset.top + 1 {
            let top = -scrollView.adjustedContentInset.top
            scrollView.setContentOffset(CGPoint(x: 0, y: max(top, scrollView.contentOffset.y - step)), animated: true)
            try? await Task.sleep(for: .seconds(1))
        }
    }
}
