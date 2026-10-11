Pod::Spec.new do |s|
  s.name           = 'QuranHealsShareFiles'
  s.version        = '1.0.0'
  s.summary        = 'Shares several images in one system share sheet for Quran Heals'
  s.description    = 'Presents UIActivityViewController with every card of a long ayah, in order.'
  s.license        = 'MIT'
  s.author         = 'Quran Heals'
  s.homepage       = 'https://example.invalid'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://example.invalid/quran-heals.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
