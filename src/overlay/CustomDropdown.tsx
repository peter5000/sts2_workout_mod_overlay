import React, { useState, useEffect, useRef } from 'react';

export interface DropdownOption {
  value: number;
  label: string;
}

export interface CustomDropdownProps {
  options: DropdownOption[];
  selectedValue: number;
  onChange: (value: number) => void;
  style?: React.CSSProperties;
  onOpenChange?: (isOpen: boolean) => void;
}

export const CustomDropdown: React.FC<CustomDropdownProps> = ({
  options,
  selectedValue,
  onChange,
  style,
  onOpenChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onOpenChange?.(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        onOpenChange?.(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  const toggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev;
      onOpenChange?.(next);
      return next;
    });
  };

  const handleSelect = (val: number) => {
    onChange(val);
    setIsOpen(false);
    onOpenChange?.(false);
  };

  const selectedOption = options.find((opt) => opt.value === selectedValue) || options[0];

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-block',
        userSelect: 'none',
        zIndex: isOpen ? 1000 : 1,
        ...style
      }}
    >
      <button
        type="button"
        className="custom-dropdown-trigger"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          padding: '2px 8px',
          borderRadius: '4px',
          border: isOpen
            ? '1px solid rgba(99, 179, 237, 0.8)'
            : '1px solid rgba(255, 255, 255, 0.25)',
          background: isOpen ? 'rgba(26, 32, 44, 0.95)' : 'rgba(0, 0, 0, 0.55)',
          color: '#63b3ed',
          fontWeight: 'bold',
          fontSize: 'clamp(10px, 2vh, 12px)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          outline: 'none',
          boxShadow: isOpen ? '0 0 8px rgba(99, 179, 237, 0.25)' : 'none',
          transition: 'all 0.15s ease'
        }}
      >
        <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selectedOption ? selectedOption.label : 'Select Player'}
        </span>
        <span
          style={{
            fontSize: '8px',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
            color: '#a0aec0',
            marginLeft: '2px'
          }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="custom-dropdown-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: '100%',
            width: 'max-content',
            maxWidth: '240px',
            background: 'rgba(15, 23, 42, 0.98)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.75)',
            zIndex: 9999,
            maxHeight: '160px',
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '3px 0'
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === selectedValue;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className="custom-dropdown-item"
                onClick={() => handleSelect(opt.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 10px',
                  gap: '8px',
                  fontSize: 'clamp(10px, 2vh, 12px)',
                  cursor: 'pointer',
                  color: isSelected ? '#63b3ed' : '#edf2f7',
                  background: isSelected ? 'rgba(49, 130, 206, 0.28)' : 'transparent',
                  fontWeight: isSelected ? 'bold' : 'normal',
                  transition: 'background 0.12s ease',
                  whiteSpace: 'nowrap'
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.label}</span>
                {isSelected && (
                  <span style={{ fontSize: '10px', color: '#63b3ed', marginLeft: '6px' }}>✓</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
