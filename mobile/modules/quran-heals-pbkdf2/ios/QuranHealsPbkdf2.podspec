Pod::Spec.new do |s|
  s.name           = 'QuranHealsPbkdf2'
  s.version        = '1.0.0'
  s.summary        = 'Native PBKDF2-HMAC-SHA256 for Quran Heals sync passwords'
  s.description    = 'Computation-only replacement for the JS PBKDF2; identical output.'
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
