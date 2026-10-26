import { setupJsdom } from './setupJsdom';
setupJsdom();

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { CustomDropdown, DropdownOption } from '../src/overlay/CustomDropdown';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export async function runUiTests() {
  console.log('🧪 Running JSDOM UI Component Unit Tests (CustomDropdown)...');

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const mockOptions: DropdownOption[] = [
    { value: 0, label: 'Hero (Host)' },
    { value: 1, label: 'Ally (Ironclad)' },
    { value: 2, label: 'Silent (Poison)' }
  ];

  let selectedValue = 0;
  let changedValue: number | null = null;
  let openStateHistory: boolean[] = [];

  const handleChange = (newVal: number) => {
    changedValue = newVal;
    selectedValue = newVal;
  };

  const handleOpenChange = (isOpen: boolean) => {
    openStateHistory.push(isOpen);
  };

  // Helper to re-render
  const renderDropdown = (val = selectedValue) => {
    act(() => {
      root.render(
        React.createElement(CustomDropdown, {
          options: mockOptions,
          selectedValue: val,
          onChange: handleChange,
          onOpenChange: handleOpenChange
        })
      );
    });
  };

  // Helper to click an element
  const click = (el: Element) => {
    act(() => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  // Helper to press a key
  const pressKey = (key: string) => {
    act(() => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    });
  };

  // Helper to click outside
  const clickOutside = () => {
    act(() => {
      document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
  };

  // --- Test 1: Initial Render State ---
  renderDropdown();
  const triggerBtn = container.querySelector('.custom-dropdown-trigger') as HTMLButtonElement;
  assert(triggerBtn !== null, 'Trigger button must be rendered in DOM');
  assert(triggerBtn.textContent?.includes('Hero (Host)') === true, 'Trigger must display the selected option label');
  assert(triggerBtn.getAttribute('aria-expanded') === 'false', 'Trigger aria-expanded must be false initially');
  assert(container.querySelector('.custom-dropdown-menu') === null, 'Dropdown menu must not be rendered when closed');
  console.log('  ✓ Initial mount & closed state verified');

  // --- Test 2: Trigger Click Opens Menu ---
  click(triggerBtn);
  assert(triggerBtn.getAttribute('aria-expanded') === 'true', 'Trigger aria-expanded must be true after opening');
  const menu = container.querySelector('.custom-dropdown-menu');
  assert(menu !== null, 'Dropdown menu must be present in DOM when opened');
  const items = container.querySelectorAll('.custom-dropdown-item');
  assert(items.length === 3, `Expected 3 dropdown options, found ${items.length}`);
  assert(openStateHistory[openStateHistory.length - 1] === true, 'onOpenChange(true) should be called');
  console.log('  ✓ Trigger click opens menu and broadcasts open state verified');

  // --- Test 3: Active Item Highlighting & Checkmark ---
  const activeItem = container.querySelector('.custom-dropdown-item[aria-selected="true"]');
  assert(activeItem !== null, 'Active option must have aria-selected="true"');
  assert(activeItem?.textContent?.includes('Hero (Host)') === true, 'Active option must match selectedValue');
  assert(activeItem?.textContent?.includes('✓') === true, 'Active option must display checkmark ✓');

  const inactiveItem = container.querySelector('.custom-dropdown-item[aria-selected="false"]');
  assert(inactiveItem !== null, 'Inactive option must have aria-selected="false"');
  assert(inactiveItem?.textContent?.includes('✓') === false, 'Inactive option must not display checkmark');
  console.log('  ✓ Option selection highlighting & checkmark state verified');

  // --- Test 4: Option Selection Fires onChange and Closes ---
  const secondOption = items[1]; // 'Ally (Ironclad)'
  click(secondOption);
  assert(changedValue === 1, `Expected onChange(1), got ${changedValue}`);
  assert(container.querySelector('.custom-dropdown-menu') === null, 'Menu must automatically close after selecting option');
  assert(openStateHistory[openStateHistory.length - 1] === false, 'onOpenChange(false) should be called after selection');

  // Re-render with new value and verify trigger update
  renderDropdown(1);
  const updatedTrigger = container.querySelector('.custom-dropdown-trigger');
  assert(updatedTrigger?.textContent?.includes('Ally (Ironclad)') === true, 'Trigger must update to new selected option label');
  console.log('  ✓ Option selection triggers onChange callback and closes dropdown verified');

  // --- Test 5: Escape Key Closes Menu ---
  click(triggerBtn);
  assert(container.querySelector('.custom-dropdown-menu') !== null, 'Menu must be open before pressing Escape');
  pressKey('Escape');
  assert(container.querySelector('.custom-dropdown-menu') === null, 'Menu must close when Escape key is pressed');
  assert(openStateHistory[openStateHistory.length - 1] === false, 'onOpenChange(false) must fire on Escape');
  console.log('  ✓ Escape key dismissal verified');

  // --- Test 6: Click Outside Closes Menu ---
  click(triggerBtn);
  assert(container.querySelector('.custom-dropdown-menu') !== null, 'Menu must be open before clicking outside');
  clickOutside();
  assert(container.querySelector('.custom-dropdown-menu') === null, 'Menu must close on outside mousedown');
  assert(openStateHistory[openStateHistory.length - 1] === false, 'onOpenChange(false) must fire on outside click');
  console.log('  ✓ Click outside dismissal verified');

  // Cleanup
  act(() => {
    root.unmount();
  });
  container.remove();

  console.log('🎉 ALL JSDOM UI COMPONENT UNIT TESTS PASSED CLEANLY!\n');
}

// Allow direct execution via ts-node
if (require.main === module) {
  runUiTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
