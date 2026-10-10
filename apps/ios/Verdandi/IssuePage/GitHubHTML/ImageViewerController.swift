import ImageIO
import UIKit

/// An image of a body, full screen over the app, as Photos shows one: it
/// fills the screen, pinching or a double tap zooms it, and swiping it up or
/// down, or Close, puts it away. It shows at once as the body showed it, and
/// at its full size once that has loaded. A tap hides Close and Share, and
/// shows them again.
final class ImageViewerController: UIViewController {
    private let load: () async -> UIImage?
    private let imageDescription: String
    private var image: UIImage?

    private let backdrop = UIView()
    private let scrollView = UIScrollView()
    private let imageView = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let failure = UILabel()
    private let closeButton = UIButton(configuration: .glass())
    private let shareButton = UIButton(configuration: .glass())
    private let caption = UILabel()
    private var loading: Task<Void, Never>?
    private var chromeHidden = false

    init(image: UIImage?, description: String, load: @escaping () async -> UIImage?) {
        self.image = image
        self.imageDescription = description
        self.load = load
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
        modalPresentationCapturesStatusBarAppearance = true
        overrideUserInterfaceStyle = .dark
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Not made from a storyboard") }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { chromeHidden }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        backdrop.backgroundColor = .black
        backdrop.frame = view.bounds
        backdrop.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(backdrop)

        scrollView.frame = view.bounds
        scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scrollView.delegate = self
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.decelerationRate = .fast
        scrollView.bouncesZoom = true
        view.addSubview(scrollView)

        imageView.contentMode = .scaleAspectFit
        imageView.isAccessibilityElement = true
        imageView.accessibilityTraits = .image
        imageView.accessibilityLabel = imageDescription.isEmpty ? "Image" : imageDescription
        scrollView.addSubview(imageView)

        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        failure.text = "The image could not be loaded."
        failure.textColor = .secondaryLabel
        failure.font = .preferredFont(forTextStyle: .body)
        failure.adjustsFontForContentSizeCategory = true
        failure.numberOfLines = 0
        failure.textAlignment = .center
        failure.isHidden = true
        failure.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(failure)

        closeButton.configuration?.image = UIImage(systemName: "xmark")
        closeButton.accessibilityLabel = "Close"
        closeButton.addAction(UIAction { [weak self] _ in self?.close() }, for: .primaryActionTriggered)
        shareButton.configuration?.image = UIImage(systemName: "square.and.arrow.up")
        shareButton.accessibilityLabel = "Share"
        shareButton.isEnabled = image != nil
        shareButton.addAction(UIAction { [weak self] _ in self?.share() }, for: .primaryActionTriggered)

        caption.text = imageDescription
        caption.isHidden = imageDescription.isEmpty || imageDescription.lowercased() == "image"
        caption.textColor = .white
        caption.font = .preferredFont(forTextStyle: .footnote)
        caption.adjustsFontForContentSizeCategory = true
        caption.numberOfLines = 3
        caption.textAlignment = .center
        caption.isAccessibilityElement = false

        for control in [closeButton, shareButton, caption] as [UIView] {
            control.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(control)
        }
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            failure.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            failure.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 32),
            failure.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -32),
            closeButton.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            closeButton.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            shareButton.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            shareButton.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            caption.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 24),
            caption.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -24),
            caption.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -16),
        ])

        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.require(toFail: doubleTap)
        scrollView.addGestureRecognizer(tap)
        let swipe = UIPanGestureRecognizer(target: self, action: #selector(swiped(_:)))
        swipe.delegate = self
        view.addGestureRecognizer(swipe)

        addKeyCommand(UIKeyCommand(title: "Close", action: #selector(closeFromKeyboard), input: UIKeyCommand.inputEscape))

        show(image)
        loadFullSize()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        fitToScreen(resetting: scrollView.zoomScale <= scrollView.minimumZoomScale + 0.001)
    }

    override func viewWillTransition(to size: CGSize, with coordinator: any UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate { [weak self] _ in self?.fitToScreen(resetting: true) }
    }

    override func accessibilityPerformEscape() -> Bool {
        close()
        return true
    }

    // MARK: Showing it

    /// Loads the image at its full size, unless it is shown at it already;
    /// the image as the body showed it stays when that fails.
    private func loadFullSize() {
        if image == nil { spinner.startAnimating() }
        loading = Task { [weak self, load] in
            let full = await load()
            guard let self, !Task.isCancelled else { return }
            spinner.stopAnimating()
            if let full {
                show(full)
            } else if image == nil {
                failure.isHidden = false
            }
        }
    }

    private func show(_ shown: UIImage?) {
        image = shown
        imageView.image = shown
        shareButton.isEnabled = shown != nil
        guard let shown else { return }
        // Back to no zoom first, which the bounds of the image shown before
        // would keep the scroll view from.
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 1
        scrollView.zoomScale = 1
        imageView.transform = .identity
        imageView.frame = CGRect(origin: .zero, size: shown.size)
        scrollView.contentSize = shown.size
        fitToScreen(resetting: true)
    }

    /// Fits the image to the screen at its smallest, and lets it zoom in
    /// four times further.
    private func fitToScreen(resetting: Bool) {
        guard let image, image.size.width > 0, image.size.height > 0, scrollView.bounds.width > 0 else { return }
        let bounds = scrollView.bounds.size
        let fit = min(bounds.width / image.size.width, bounds.height / image.size.height)
        scrollView.minimumZoomScale = fit
        scrollView.maximumZoomScale = max(fit * 4, 2)
        if resetting || scrollView.zoomScale < fit { scrollView.zoomScale = fit }
        center()
    }

    /// Keeps the image in the middle of the screen while it is smaller.
    private func center() {
        let bounds = scrollView.bounds.size
        let size = scrollView.contentSize
        let horizontal = max(0, (bounds.width - size.width) / 2)
        let vertical = max(0, (bounds.height - size.height) / 2)
        scrollView.contentInset = UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
    }

    // MARK: Gestures

    @objc private func doubleTapped(_ recognizer: UITapGestureRecognizer) {
        if scrollView.zoomScale > scrollView.minimumZoomScale + 0.001 {
            scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
            return
        }
        let point = recognizer.location(in: imageView)
        let scale = min(scrollView.maximumZoomScale, scrollView.minimumZoomScale * 2.5)
        let size = CGSize(width: scrollView.bounds.width / scale, height: scrollView.bounds.height / scale)
        scrollView.zoom(
            to: CGRect(origin: CGPoint(x: point.x - size.width / 2, y: point.y - size.height / 2), size: size),
            animated: true)
    }

    @objc private func tapped() {
        chromeHidden.toggle()
        UIView.animate(withDuration: 0.2) {
            for control in [self.closeButton, self.shareButton, self.caption] as [UIView] {
                control.alpha = self.chromeHidden ? 0 : 1
            }
        }
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }

    /// Moves the image with the finger, fading the black behind it, and
    /// puts it away once moved far or fast enough.
    @objc private func swiped(_ recognizer: UIPanGestureRecognizer) {
        let translation = recognizer.translation(in: view)
        let progress = min(1, abs(translation.y) / max(view.bounds.height / 2, 1))
        switch recognizer.state {
        case .changed:
            scrollView.transform = CGAffineTransform(translationX: translation.x * 0.3, y: translation.y)
            backdrop.alpha = 1 - progress * 0.8
        case .ended, .cancelled:
            let velocity = recognizer.velocity(in: view).y
            if recognizer.state == .ended, abs(translation.y) > 110 || abs(velocity) > 900 {
                let direction: CGFloat = (translation.y == 0 ? velocity : translation.y) < 0 ? -1 : 1
                UIView.animate(withDuration: 0.22, delay: 0, options: .curveEaseIn) {
                    self.scrollView.transform = CGAffineTransform(
                        translationX: translation.x * 0.3, y: direction * self.view.bounds.height)
                    self.backdrop.alpha = 0
                    for control in [self.closeButton, self.shareButton, self.caption] as [UIView] {
                        control.alpha = 0
                    }
                } completion: { _ in
                    self.dismiss(animated: false)
                }
            } else {
                UIView.animate(
                    withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0
                ) {
                    self.scrollView.transform = .identity
                    self.backdrop.alpha = 1
                }
            }
        default:
            break
        }
    }

    // MARK: Actions

    private func close() {
        loading?.cancel()
        dismiss(animated: true)
    }

    @objc private func closeFromKeyboard() { close() }

    private func share() {
        guard let image else { return }
        let sheet = UIActivityViewController(activityItems: [image], applicationActivities: nil)
        // Saving to Photos would need the app to ask for access to them.
        sheet.excludedActivityTypes = [.saveToCameraRoll]
        sheet.popoverPresentationController?.sourceView = shareButton
        present(sheet, animated: true)
    }
}

extension ImageViewerController: UIScrollViewDelegate {
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) { center() }
}

extension ImageViewerController: UIGestureRecognizerDelegate {
    /// Swiping puts the image away only while it fits the screen, and only
    /// up or down.
    func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
        guard let pan = recognizer as? UIPanGestureRecognizer else { return true }
        guard scrollView.zoomScale <= scrollView.minimumZoomScale + 0.001 else { return false }
        let velocity = pan.velocity(in: view)
        return abs(velocity.y) > abs(velocity.x)
    }
}

extension UIImage {
    /// An image from its bytes, moving as a GIF or animated PNG does: the
    /// viewer shows it at its own pixels, which it zooms from. Decoded, an
    /// image can take far more memory than its file: a 10 MB GIF of 300
    /// frames at 2560×1600 would take 5 GB. So each frame is decoded at
    /// most so large that all of them fit `budget` bytes, and a long
    /// animation shows every other frame, or fewer, rather than shrink to
    /// a blur.
    nonisolated static func decoded(from data: Data) -> UIImage? {
        let budget = 160 * 1024 * 1024
        let largest = 4096
        let smallest = 360
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let count = CGImageSourceGetCount(source)
        guard count > 0 else { return nil }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let width = properties?[kCGImagePropertyPixelWidth] as? Int ?? largest
        let height = properties?[kCGImagePropertyPixelHeight] as? Int ?? largest
        let own = max(width, height, 1)
        let aspect = Double(min(width, height, own)) / Double(own)
        // The longest side that lets `frames` frames fit the budget.
        func side(for frames: Int) -> Int {
            let pixels = Double(budget) / 4 / Double(max(frames, 1))
            return min(own, largest, Int((pixels / max(aspect, 0.01)).squareRoot()))
        }
        var step = 1
        while count / step > 1, side(for: (count + step - 1) / step) < min(smallest, own) { step += 1 }
        let maxSide = side(for: (count + step - 1) / step)
        let options =
            [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: maxSide,
            ] as CFDictionary
        guard count > 1 else {
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options).map { UIImage(cgImage: $0) }
        }
        var frames: [UIImage] = []
        var duration: Double = 0
        for index in stride(from: 0, to: count, by: step) {
            // The frames left out still take their time.
            for skipped in index..<min(index + step, count) { duration += frameDuration(source, at: skipped) }
            guard let frame = CGImageSourceCreateThumbnailAtIndex(source, index, options) else { continue }
            frames.append(UIImage(cgImage: frame))
        }
        guard !frames.isEmpty else { return nil }
        return frames.count == 1 ? frames[0] : UIImage.animatedImage(with: frames, duration: duration)
    }

    private nonisolated static func frameDuration(_ source: CGImageSource, at index: Int) -> Double {
        let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
        let animation =
            (properties?[kCGImagePropertyGIFDictionary] ?? properties?[kCGImagePropertyPNGDictionary])
            as? [CFString: Any]
        let delay =
            (animation?[kCGImagePropertyGIFUnclampedDelayTime] ?? animation?[kCGImagePropertyAPNGUnclampedDelayTime]
                ?? animation?[kCGImagePropertyGIFDelayTime] ?? animation?[kCGImagePropertyAPNGDelayTime]) as? Double
        // Browsers show frames shorter than this as 0.1 seconds long.
        return (delay ?? 0.1) < 0.02 ? 0.1 : (delay ?? 0.1)
    }
}
